"""
Синхронизатор каталога: тянет товары, атрибуты, цены и остатки из Ozon Seller API
(только read-методы, ключ OZON_API_KEY read-only) и сохраняет/обновляет карточки в PostgreSQL.

В БД сохраняются только товары бренда Omegation (атрибут #85, см.
catalog_rules.is_omegation_brand) — остальной ассортимент продавца на Ozon
в базу не попадает вообще, а не просто скрывается на витрине. Если товар
раньше был синхронизирован (например, до включения этого фильтра), а сейчас
определяется как чужой бренд — его карточка удаляется из БД при следующей
синхронизации (см. блок "не наш бренд" в run_sync).

Уважает флаг manual_override: если карточку отредактировали в админке,
контентные поля (name/description/brand/category_name/images) больше не перезаписываются
синхронизатором. Цена/остатки/статус модерации/is_archived обновляются всегда.

Изображения товаров скачиваются с CDN Ozon на сервер в UPLOAD_DIR и раздаются
бэкендом по постоянным адресам /api/images/<uid> (см. main.py: get_image).
Публичные поля primary_image и PartImage.url содержат только такой адрес.
uid выдаётся фото один раз и не меняется, когда на Ozon заменили картинку на
той же позиции — в этом случае обновляется только файл (PartImage.file_name),
см. _sync_part_images. Исходные URL Ozon сохраняются только в служебных полях
source_url / primary_image_source_url, не попадают в публичное API и не
используются как fallback. Если скачивание не удалось, изображение пропускается
и будет повторно запрошено при следующей синхронизации.

ВАЖНО: поле primary_image в ответе /v3/product/info/list библиотеки ozonapi-async
типизировано как Optional[list[str]] (список), а не одиночная строка.
"""
import asyncio
import hashlib
import logging
import os
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from ozonapi import SellerAPI, SellerAPIConfig
from ozonapi.seller.schemas.products import (
    ProductListRequest,
    ProductInfoListRequest,
    ProductInfoAttributesRequest,
)

from database import SessionLocal, init_db
from models import Part, PartImage, PartAttribute, PartStock, SyncLog, SyncSettings, new_image_uid
from catalog_rules import is_omegation_brand

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("sync_ozon")

BATCH_SIZE = 100
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/app/uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PUBLIC_IMAGE_PREFIX = "/api/images"

IMAGE_DOWNLOAD_TIMEOUT_SECONDS = 15
ALLOWED_IMAGE_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

_http_client = httpx.Client(timeout=IMAGE_DOWNLOAD_TIMEOUT_SECONDS, follow_redirects=True)


def _now():
    return datetime.now(timezone.utc)


def get_or_create_sync_settings(db) -> SyncSettings:
    """Возвращает единственную строку настроек синхронизации, создавая её
    с дефолтами (интервал — из SYNC_INTERVAL_MINUTES для обратной совместимости
    со старым способом настройки через .env) при первом обращении."""
    settings = db.query(SyncSettings).filter_by(id=1).one_or_none()
    if settings is None:
        settings = SyncSettings(
            id=1,
            interval_minutes=int(os.getenv("SYNC_INTERVAL_MINUTES", "60")),
            auto_sync_enabled=True,
            download_images_enabled=True,
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def _to_decimal(value):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


def _first_image_url(value):
    """Берёт первый URL из списка primary_image или возвращает строку как есть."""
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return value[0] if value else None
    return value


def _guess_extension(source_url: str, content_type: str | None) -> str:
    normalized_content_type = (content_type or "").split(";", 1)[0].strip().lower()
    if normalized_content_type in ALLOWED_IMAGE_CONTENT_TYPES:
        return ALLOWED_IMAGE_CONTENT_TYPES[normalized_content_type]
    suffix = Path(urlsplit(source_url).path).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".webp"}:
        return suffix
    return ".jpg"


def download_image(source_url: str) -> str | None:
    """Скачивает изображение в UPLOAD_DIR и возвращает имя файла (не URL).

    При любой ошибке возвращает None. Внешний URL Ozon никогда не используется как
    URL изображения для пользователя. Публичный адрес фото строится из uid
    строки PartImage, а не из имени файла — см. _sync_part_images.
    """
    if not source_url:
        return None

    url_hash = hashlib.sha256(source_url.encode("utf-8")).hexdigest()
    for existing in UPLOAD_DIR.glob(f"{url_hash}.*"):
        return existing.name

    try:
        response = _http_client.get(source_url)
        response.raise_for_status()
    except Exception as exc:
        logger.warning("Не удалось скачать изображение %s: %s", source_url, exc)
        return None

    extension = _guess_extension(source_url, response.headers.get("content-type"))
    destination = UPLOAD_DIR / f"{url_hash}{extension}"
    try:
        destination.write_bytes(response.content)
    except OSError as exc:
        logger.warning("Не удалось сохранить изображение %s: %s", source_url, exc)
        return None

    return destination.name


def _remove_unreferenced_files(db, file_names):
    """Удаляет файлы из UPLOAD_DIR, на которые больше не ссылается ни одна
    строка PartImage (один и тот же файл может быть общим у нескольких карточек,
    поэтому удаляем только после проверки)."""
    for file_name in {f for f in file_names if f}:
        still_used = db.query(PartImage.id).filter(PartImage.file_name == file_name).first()
        if still_used is None:
            try:
                (UPLOAD_DIR / Path(file_name).name).unlink(missing_ok=True)
            except OSError as exc:
                logger.warning("Не удалось удалить неиспользуемый файл %s: %s", file_name, exc)


def _sync_part_images(db, part, item, primary_source, image_stats=None):
    """Приводит галерею PartImage карточки в соответствие с фото на Ozon,
    сохраняя uid (и значит публичный адрес) уже существующих фото.

    Сопоставление существующих строк с актуальным списком фото Ozon:
      1. по source_url — то же самое фото, файл не трогаем (только порядок);
      2. остальные новые фото занимают освободившиеся строки по порядку —
         это и есть "замена фото на Ozon": uid/url остаются прежними,
         обновляется только file_name и source_url;
      3. фото сверх того — новые строки с новым uid;
      4. строки, которым не нашлось пары (фото убрали на Ozon), удаляются.
    """
    sources = []
    seen = set()
    candidates = list(getattr(item, "images", None) or [])
    # Ozon отдаёт primary_image отдельным полем от общего списка images —
    # оно не всегда туда продублировано, поэтому добавляем его в начало.
    if primary_source:
        candidates = [primary_source] + candidates
    for source in candidates:
        if source and source not in seen:
            seen.add(source)
            sources.append(source)

    existing = (
        db.query(PartImage)
        .filter_by(part_id=part.id)
        .order_by(PartImage.sort_order, PartImage.id)
        .all()
    )
    by_source = {}
    for row in existing:
        if row.source_url and row.file_name and row.source_url not in by_source:
            by_source[row.source_url] = row

    final_rows = {}      # source_url -> PartImage
    used_ids = set()
    for source in sources:
        row = by_source.get(source)
        if row is not None and row.id not in used_ids and (UPLOAD_DIR / Path(row.file_name).name).is_file():
            final_rows[source] = row
            used_ids.add(row.id)
            if image_stats is not None:
                image_stats["downloaded"] = image_stats.get("downloaded", 0) + 1

    # Строки, чьё фото на Ozon пропало или заменено — кандидаты на повторное
    # использование (только те, что пришли с Ozon; загруженные вручную
    # админом, как и раньше, при возврате к синхронизации не сохраняются).
    leftovers = [r for r in existing if r.id not in used_ids and r.source_url]
    obsolete_files = []

    for source in sources:
        if source in final_rows:
            continue
        file_name = download_image(source)
        if not file_name:
            logger.warning(
                "Фото пропущено для offer_id=%s: не удалось скачать %s", part.offer_id, source,
            )
            if image_stats is not None:
                image_stats["failed"] = image_stats.get("failed", 0) + 1
            continue

        row = by_source.get(source)
        if row is None or row.id in used_ids:
            row = next((r for r in leftovers if r.id not in used_ids), None)

        if row is not None:
            # Замена фото на этой позиции: uid и url прежние, меняется только файл.
            if row.file_name and row.file_name != file_name:
                obsolete_files.append(row.file_name)
            row.file_name = file_name
            row.source_url = source
        else:
            uid = new_image_uid()
            row = PartImage(
                part_id=part.id,
                uid=uid,
                url=f"{PUBLIC_IMAGE_PREFIX}/{uid}",
                file_name=file_name,
                source_url=source,
            )
            db.add(row)
        if row.id is not None:
            used_ids.add(row.id)
        final_rows[source] = row
        if image_stats is not None:
            image_stats["downloaded"] = image_stats.get("downloaded", 0) + 1

    kept_objects = set(id(r) for r in final_rows.values())
    for row in existing:
        if id(row) not in kept_objects:
            if row.file_name:
                obsolete_files.append(row.file_name)
            db.delete(row)

    for order, source in enumerate(sources):
        row = final_rows.get(source)
        if row is None:
            continue
        row.sort_order = order
        row.is_primary = bool(primary_source) and source == primary_source

    primary_row = final_rows.get(primary_source) if primary_source else None
    if primary_row is not None:
        part.primary_image = primary_row.url
        part.primary_image_source_url = primary_source
    else:
        part.primary_image = None
        part.primary_image_source_url = None

    db.flush()
    _remove_unreferenced_files(db, obsolete_files)


async def fetch_all_offer_ids(api: SellerAPI):
    offer_ids = []
    last_id = ""
    while True:
        request = ProductListRequest(limit=1000, last_id=last_id)
        response = await api.product_list(request)
        items = response.result.items
        if not items:
            break
        offer_ids.extend(item.offer_id for item in items if item.offer_id)
        last_id = response.result.last_id
        if not last_id or len(items) < 1000:
            break
    logger.info("Собрано offer_id: %d", len(offer_ids))
    return offer_ids


async def fetch_product_details(api: SellerAPI, offer_ids):
    all_items = []
    for i in range(0, len(offer_ids), BATCH_SIZE):
        batch = offer_ids[i:i + BATCH_SIZE]
        request = ProductInfoListRequest(offer_id=batch)
        response = await api.product_info_list(request)
        all_items.extend(response.items)
        logger.info("Обработан батч %d-%d из %d", i, i + len(batch), len(offer_ids))
    return all_items


async def fetch_attributes(api: SellerAPI, offer_ids):
    attributes_by_offer = {}
    for i in range(0, len(offer_ids), BATCH_SIZE):
        batch = offer_ids[i:i + BATCH_SIZE]
        request = ProductInfoAttributesRequest(
            filter={"offer_id": batch},
            limit=len(batch),
        )
        response = await api.product_info_attributes(request)
        for item in response.result:
            attributes_by_offer[item.offer_id] = item.attributes
    return attributes_by_offer


def upsert_part(db, item, attributes, download_images=True, image_stats=None):
    """Создаёт/обновляет карточку. Контент не трогается при manual_override=True.

    download_images=False пропускает скачивание фото целиком: часть с
    данными (цена/остатки/атрибуты/название и т.д.) синхронизируется как
    обычно, а part.primary_image и галерея PartImage не трогаются вообще
    (остаются в том виде, в каком были). Используется для быстрой
    синхронизации "только данные" или когда скачивание фото отключено в
    настройках.

    image_stats, если передан, — dict-счётчик, в который пишутся
    downloaded/failed/skipped по ходу обработки этой карточки (для отчёта
    в SyncLog.details).
    """
    part = db.query(Part).filter_by(ozon_product_id=item.id).one_or_none()
    if part is None:
        part = Part(ozon_product_id=item.id)
        db.add(part)

    primary_source = None

    part.offer_id = item.offer_id
    part.ozon_sku = getattr(item, "sku", None)
    # Цена с FTP приоритетнее цены Ozon (см. ftp_price_sync.py) — пока она
    # задана, обычная синхронизация её не трогает.
    if part.ftp_price is None:
        part.price = _to_decimal(getattr(item, "price", None))
    part.old_price = _to_decimal(getattr(item, "old_price", None))
    part.currency_code = getattr(item, "currency_code", "RUB") or "RUB"

    statuses = getattr(item, "statuses", None)
    if statuses is not None:
        part.moderate_status = getattr(statuses, "moderate_status", None)
    part.is_archived = bool(getattr(item, "archived", False))

    stocks_obj = getattr(item, "stocks", None)
    if part.id:
        db.query(PartStock).filter_by(part_id=part.id).delete()
    if stocks_obj is not None:
        part.has_stock = bool(getattr(stocks_obj, "has_stock", False))
    part.last_synced_at = _now()

    if not part.manual_override:
        part.name = getattr(item, "name", None) or part.offer_id
        part.barcode = getattr(item, "barcode", None)
        part.category_id = getattr(item, "description_category_id", None)
        part.weight = getattr(item, "weight", None)
        part.weight_unit = getattr(item, "weight_unit", None)
        part.depth = getattr(item, "depth", None)
        part.width = getattr(item, "width", None)
        part.height = getattr(item, "height", None)
        part.dimension_unit = getattr(item, "dimension_unit", None)

        primary_source = _first_image_url(getattr(item, "primary_image", None))
        if not download_images and image_stats is not None and primary_source:
            # Фото не трогаем вообще — ни основное, ни галерею (см. ниже).
            image_stats["skipped"] = image_stats.get("skipped", 0) + 1

    db.flush()

    if stocks_obj is not None:
        for s in getattr(stocks_obj, "stocks", []) or []:
            db.add(PartStock(
                part_id=part.id,
                warehouse_name=getattr(s, "source", None),
                present=getattr(s, "present", 0),
                reserved=getattr(s, "reserved", 0),
                stock_type=getattr(s, "type", None),
            ))

    if not part.manual_override and download_images:
        _sync_part_images(db, part, item, primary_source, image_stats)
    elif not part.manual_override and image_stats is not None:
        skipped_count = len(getattr(item, "images", None) or [])
        if skipped_count:
            image_stats["skipped"] = image_stats.get("skipped", 0) + skipped_count

    db.query(PartAttribute).filter_by(part_id=part.id).delete()
    for attr in attributes or []:
        values = getattr(attr, "values", []) or []
        value_text = "; ".join(
            str(getattr(v, "value", "")) for v in values if getattr(v, "value", None)
        )
        db.add(PartAttribute(
            part_id=part.id,
            ozon_attribute_id=getattr(attr, "id", 0),
            value=value_text or None,
            dictionary_value_id=(
                getattr(values[0], "dictionary_value_id", None) if values else None
            ),
        ))

    return part


async def run_sync(download_images: bool | None = None, trigger: str = "scheduled"):
    """download_images=None — берётся из настроек синхронизации в БД
    (SyncSettings.download_images_enabled). Явное True/False переопределяет
    настройку для этого конкретного запуска (используется ручным запуском
    из админки), саму настройку не меняет.
    trigger — "scheduled" | "manual", попадает в SyncLog.details для истории.
    """
    client_id = os.getenv("OZON_CLIENT_ID")
    api_key = os.getenv("OZON_API_KEY")
    if not client_id or not api_key:
        raise RuntimeError("OZON_CLIENT_ID / OZON_API_KEY не заданы в окружении")

    init_db()
    db = SessionLocal()

    settings = get_or_create_sync_settings(db)
    effective_download_images = (
        settings.download_images_enabled if download_images is None else download_images
    )

    log_entry = SyncLog(status="running")
    db.add(log_entry)
    db.commit()

    processed = 0
    failed = 0
    skipped_other_brand = 0
    removed_other_brand = 0
    image_stats = {"downloaded": 0, "failed": 0, "skipped": 0}

    try:
        config = SellerAPIConfig(client_id=client_id, api_key=api_key)
        async with SellerAPI(config=config) as api:
            offer_ids = await fetch_all_offer_ids(api)
            if not offer_ids:
                logger.warning("На аккаунте не найдено ни одного товара")

            details = await fetch_product_details(api, offer_ids)
            attributes_map = await fetch_attributes(api, offer_ids)

            for item in details:
                try:
                    item_attributes = attributes_map.get(item.offer_id, [])

                    if not is_omegation_brand(item_attributes):
                        # Не наш бренд — в БД не сохраняем. Если карточка уже
                        # была синхронизирована раньше (до этого фильтра или
                        # если продавец сменил бренд у offer_id) — удаляем её,
                        # каскадом уходят и её фото/атрибуты/остатки/история.
                        skipped_other_brand += 1
                        existing = db.query(Part).filter_by(ozon_product_id=item.id).one_or_none()
                        if existing is not None:
                            db.delete(existing)
                            db.commit()
                            removed_other_brand += 1
                        continue

                    upsert_part(
                        db, item, item_attributes,
                        download_images=effective_download_images,
                        image_stats=image_stats,
                    )
                    db.commit()
                    processed += 1
                except Exception as exc:
                    db.rollback()
                    failed += 1
                    logger.exception("Ошибка при сохранении offer_id=%s: %s", item.offer_id, exc)

        log_entry.status = "success" if failed == 0 else "success_with_errors"
    except Exception as exc:
        log_entry.status = "failed"
        log_entry.error_message = str(exc)
        logger.exception("Синхронизация прерввана: %s", exc)
    finally:
        log_entry.finished_at = _now()
        log_entry.products_processed = processed
        log_entry.products_failed = failed
        log_entry.details = {
            "trigger": trigger,
            "download_images_enabled": effective_download_images,
            "images_downloaded": image_stats["downloaded"],
            "images_failed": image_stats["failed"],
            "images_skipped": image_stats["skipped"],
            "skipped_other_brand": skipped_other_brand,
            "removed_other_brand": removed_other_brand,
        }
        db.commit()
        db.close()
        logger.info(
            "Синхронизация завершена: обработано=%d, ошибок=%d, фото скачано=%d, фото не скачано=%d, "
            "не наш бренд пропущено=%d, удалено из БД=%d",
            processed, failed, image_stats["downloaded"], image_stats["failed"],
            skipped_other_brand, removed_other_brand,
        )


if __name__ == "__main__":
    asyncio.run(run_sync())
