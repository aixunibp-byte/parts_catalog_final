"""
FastAPI backend каталога автозапчастей.
В БД (и, соответственно, везде в API — и на публичной витрине, и в
админке) хранятся только товары бренда Omegation (атрибут #85) — синхронизация
(sync_ozon.py) не сохраняет остальной ассортимент продавца на Ozon вообще,
см. catalog_rules.py. Фильтр по бренду в запросах ниже (_omegation_brand_clause)
оставлен как дополнительная защита на чтение, а не единственный барьер.
Поиск дополнительно учитывает атрибут #9048 (номер детали/аналога).

Загрузка изображений в admin_upload_image проверяет реальное содержимое файла
через Pillow (Image.verify()), а не доверяет заявленному клиентом Content-Type или
расширению из имени файла. Файл с реальный SVG/HTML/любым не-растровым
содержимым будет отклонён ещё до завершения загрузки, что закрывает вектор
сохранённого XSS через прямое открытие загруженного URL.

CORS-origin берётся из переменной окружения FRONTEND_ORIGIN (по умолчанию —
пустой строкой, т.е. без широких разрешений), вместо жёстко зашитого "*".
"""
import io
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, BackgroundTasks, Depends, Header, HTTPException, Query, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from sqlalchemy import or_, and_, case, func
from sqlalchemy.orm import Session
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from database import get_db, init_db
from models import (
    Part, PartImage, PartAttribute, PartStock, SyncLog, AdminAuditLog, SiteContent, SyncSettings,
    User, LoginAttempt, new_image_uid,
)
from admin_auth import (
    require_viewer, require_editor, require_full, get_current_user,
    create_session, revoke_session, revoke_user_sessions, verify_password_timing_safe,
    hash_password, needs_rehash,
)
from security import (
    client_ip, check_admin_uid, admin_gate_configured, FailureBan,
)
from admin_schemas import (
    PartContentUpdate, ImageReorderRequest, AddImageByUrlRequest, RevertToSyncRequest,
    SiteContentUpdate, SyncSettingsUpdate, SyncRunRequest, FtpConnectionTestRequest,
    LoginRequest, UserCreateRequest, UserUpdateRequest,
)
from sync_ozon import run_sync as run_ozon_sync, get_or_create_sync_settings
from ftp_price_sync import run_ftp_price_sync, test_ftp_connection
from catalog_rules import (
    BRAND_ATTRIBUTE_ID, ARTICLE_ATTRIBUTE_ID, BRAND_FILTER_VALUE, ALLOWED_ATTRIBUTE_IDS,
)

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/app/uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PUBLIC_UPLOAD_PREFIX = "/uploads"
# Постоянные адреса фото: /api/images/<uid> (снаружи, через nginx /api/ ->
# бэкенд /images/<uid>). uid не меняется при замене файла.
PUBLIC_IMAGE_PREFIX = "/api/images"
IMAGE_UID_RE = re.compile(r"^[0-9a-f]{32}$")
# Адрес фиксирован, а содержимое может смениться (замена фото) — поэтому кэш
# короткий, плюс ETag по имени файла, чтобы браузер дёшево перепроверял.
IMAGE_CACHE_CONTROL = "public, max-age=600"

MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024

# Форматы, которые Pillow должен реально распознать в байтах файла.
# Соответствие заявленного Content-Type не играет роли — оно присылается клиентом
# и может быть подделано; реальный формат определяет Pillow по самим байтам.
ALLOWED_IMAGE_FORMATS = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "")
CORS_ALLOWED_ORIGINS = [FRONTEND_ORIGIN] if FRONTEND_ORIGIN else []

# В проде прячем интерактивную документацию (/docs, /redoc, /openapi.json) —
# не даёт готовую карту всех эндпоинтов кому попало. Для разработки
# (APP_ENV=development или не задано) документация остаётся доступной.
IS_PRODUCTION = os.getenv("APP_ENV", "development").lower() == "production"

# Значения по умолчанию для редактируемого контента (шапка/о нас/контакты).
# Используются, пока админ ни разу не сохранил свои значения через /admin/settings —
# совпадают с прежним зашитым в код текстом, чтобы после обновления ничего не "потерялось".
DEFAULT_SITE_CONTENT = {
    "hero": {
        "title": "Omegation — новые стандарты качества в автокомпонентах",
        "description": (
            "Omegation — молодая и динамично развивающаяся компания, специализирующаяся на поставке "
            "автозапчастей для легковых и коммерческих автомобилей. Несмотря на недавнее основание, "
            "мы уже выстроили современную систему контроля качества и логистическую цепочку, "
            "позволяющую предлагать рынку один из самых широких и технологичных ассортиментов "
            "в своём сегменте."
        ),
    },
    "about": {
        "tagline": "OMEGATION: ТОЧНОСТЬ. НАДЁЖНОСТЬ. ДВИЖЕНИЕ ВПЕРЁД.",
        "intro": (
            "OMEGATION поставляет автозапчасти для легковых и коммерческих автомобилей. Несмотря на "
            "молодость компании, мы уже выстроили современную логистику и строгий контроль качества — "
            "и предлагаем один из самых широких ассортиментов в сегменте."
        ),
        "sections": [
            {
                "title": "Широкий ассортимент",
                "text": (
                    "Более тысячи наименований: двигатель и трансмиссия, подвеска и рулевое, тормозная "
                    "система, автоэлектрика, расходники. Линейку регулярно расширяем — под популярные "
                    "и редкие модели."
                ),
            },
            {
                "title": "Контроль качества и стандарты",
                "text": (
                    "Каждая партия проходит входной контроль и проверку на соответствие "
                    "OEM-спецификациям — точная геометрия и стабильный ресурс гарантированы."
                ),
            },
            {
                "title": "Отбор поставщиков",
                "text": (
                    "Работаем только с проверенными производителями. Обязательные требования к каждому "
                    "партнёру: износостойкие сплавы, точные допуски, конструкции под реальные "
                    "дорожные условия."
                ),
            },
            {
                "title": "Для бизнеса и частных клиентов",
                "text": (
                    "Работаем с СТО, дилерами, автомагазинами и напрямую с водителями. Склад всегда "
                    "полон, отгрузка быстрая, документация и гарантия — прозрачные."
                ),
            },
        ],
        "closing": (
            "Наша цель — качественные запчасти, доступные и всегда в наличии. Каждая деталь OMEGATION — "
            "это уверенность в безопасности и долговечности вашего автомобиля."
        ),
    },
    "contacts": {
        "phone": "+7 (000) 000-00-00",
        "email": "info@omegation.ru",
        "address": "г. Москва, ул. Примерная, д. 1",
        "hours": "Пн–Пт: 9:00–18:00",
    },
}


def utcnow():
    return datetime.now(timezone.utc)


app = FastAPI(
    title="Parts Catalog API",
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)

# Общий лимит на все эндпоинты по IP — защита от скрейпинга каталога и
# перебора admin-токена. Значение с запасом для обычного использования сайта
# (одна загрузка страницы делает несколько запросов), но останавливает
# автоматизированный перебор/скрейпинг. При необходимости можно добавить
# @limiter.limit("N/minute") на конкретный роут для более строгого лимита —
# для этого в его сигнатуру нужно добавить параметр request: Request.
#
# Ключ лимита — РЕАЛЬНЫЙ IP посетителя (client_ip), а не адрес из соединения:
# api стоит за nginx, и request.client.host у всех запросов — это адрес
# контейнера nginx. Раньше (get_remote_address) у всего сайта был один общий
# счётчик: несколько посетителей исчерпывали лимит друг за друга.
limiter = Limiter(key_func=client_ip, default_limits=["120/minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

logger = logging.getLogger("security")

# --- Секретный адрес входа в админку (ADMIN_URL_UID) ---
# Все пути /admin* отвечают 404, пока в заголовке X-Admin-Uid нет верного
# значения (его подставляет фронтенд, взяв uid из адреса /console/<uid>/...).
# Не настроен ADMIN_URL_UID — админ-API закрыт целиком (fail closed).
# Это дополнительный слой ПЕРЕД логином/паролем, а не замена им.
ADMIN_GATE_PREFIX = "/admin"
# 8 неверных uid с одного IP за 10 минут -> бан на час (только для /admin*).
admin_probe_ban = FailureBan(
    max_failures=int(os.getenv("ADMIN_PROBE_MAX_FAILURES", "8")),
    window_seconds=600,
    ban_seconds=int(os.getenv("ADMIN_PROBE_BAN_SECONDS", "3600")),
)


class AdminGateMiddleware:
    """Чистый ASGI-middleware (не BaseHTTPMiddleware): не буферизует тела
    запросов и не ломает загрузку файлов."""

    def __init__(self, asgi_app):
        self.app = asgi_app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        if not (path == ADMIN_GATE_PREFIX or path.startswith(ADMIN_GATE_PREFIX + "/")):
            return await self.app(scope, receive, send)
        # Предзапросы CORS отвечает CORSMiddleware (он снаружи), сюда они не доходят.
        request = Request(scope)
        ip = client_ip(request)
        if admin_probe_ban.is_banned(ip):
            return await self._not_found(scope, receive, send)
        if not check_admin_uid(request.headers.get("x-admin-uid")):
            if admin_probe_ban.register_failure(ip):
                logger.warning("admin gate: IP %s забанен за подбор адреса админки", ip)
            else:
                logger.info("admin gate: отказ %s %s от %s", request.method, path, ip)
            return await self._not_found(scope, receive, send)
        return await self.app(scope, receive, send)

    @staticmethod
    async def _not_found(scope, receive, send):
        # Тот же ответ, что у несуществующего маршрута FastAPI.
        response = JSONResponse({"detail": "Not Found"}, status_code=404)
        await response(scope, receive, send)


# Порядок: последний добавленный — самый внешний. Снаружи CORS, затем лимиты,
# затем проверка uid админки.
app.add_middleware(AdminGateMiddleware)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Admin-Uid"],
)

app.mount(PUBLIC_UPLOAD_PREFIX, StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


@app.on_event("startup")
def on_startup():
    init_db()
    if not admin_gate_configured():
        logger.error(
            "ADMIN_URL_UID не задан или некорректен (24-64 символа A-Za-z0-9_-): "
            "админ-API ЗАКРЫТО для всех. Сгенерируйте: openssl rand -hex 24"
        )
    if IS_PRODUCTION and os.getenv("ALLOW_INSECURE_DEFAULTS") != "1":
        for name in ("POSTGRES_PASSWORD",):
            value = os.getenv(name, "")
            if value in ("", "postgres", "password", "changeme", "change_me"):
                logger.error("%s пустой или слабый — замените в .env", name)


@app.get("/health")
def health():
    return {"status": "ok"}


def _merged_site_content(db: Session) -> dict:
    rows = {row.key: row.value for row in db.query(SiteContent).all()}
    return {key: rows.get(key) or default for key, default in DEFAULT_SITE_CONTENT.items()}


def _image_file_path(file_name: str) -> Path:
    # file_name всегда генерируется сервером, но на всякий случай берём только имя.
    return UPLOAD_DIR / Path(file_name).name


@app.get("/admin/ping")
def admin_ping():
    """Проверка секретного uid (ответ 200 даёт только AdminGateMiddleware —
    при неверном uid сюда запрос не доходит и приходит 404). Нужен
    фронтенду, чтобы не показывать форму входа по неверной ссылке."""
    return {"ok": True}


@app.get("/images/{uid}")
@limiter.exempt
def get_image(uid: str, request: Request, db: Session = Depends(get_db)):
    """Постоянный публичный адрес фото (снаружи — /api/images/<uid>).

    uid закреплён за "местом" фото в карточке и не меняется при замене
    файла: отдаём то, что лежит там сейчас. Для фото, добавленного
    админом по внешней ссылке, перенаправляем на эту ссылку."""
    if not IMAGE_UID_RE.match(uid):
        raise HTTPException(status_code=404, detail="Изображение не найдено")
    image = db.query(PartImage).filter(PartImage.uid == uid).one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Изображение не найдено")

    if image.file_name:
        path = _image_file_path(image.file_name)
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Файл изображения не найден")
        etag = f'"{image.file_name}"'
        headers = {"ETag": etag, "Cache-Control": IMAGE_CACHE_CONTROL}
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers=headers)
        return FileResponse(path, headers=headers)

    if image.source_url:
        return RedirectResponse(image.source_url, status_code=302,
                                headers={"Cache-Control": IMAGE_CACHE_CONTROL})
    raise HTTPException(status_code=404, detail="Изображение не найдено")


@app.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    """Публично отдаёт редактируемый текст сайта (шапка/о нас/контакты).
    Пока админ ничего не сохранил — возвращаются значения по умолчанию."""
    return _merged_site_content(db)


def _get_attribute_value(part: Part, attribute_id: int) -> Optional[str]:
    for a in part.attributes:
        if a.ozon_attribute_id == attribute_id and a.value:
            return a.value
    return None


def serialize_part_short(part: Part) -> dict:
    article = _get_attribute_value(part, ARTICLE_ATTRIBUTE_ID) or part.offer_id
    return {
        "id": part.id,
        "offer_id": part.offer_id,
        "article": article,
        "name": part.name,
        "brand": part.brand,
        "price": float(part.price) if part.price is not None else None,
        "old_price": float(part.old_price) if part.old_price is not None else None,
        "currency_code": part.currency_code,
        "primary_image": part.primary_image,
        "has_stock": part.has_stock,
        "is_archived": part.is_archived,
        "manual_override": part.manual_override,
        # Нужны фронтенду, чтобы собрать ссылку "Купить на Ozon"
        "ozon_product_id": part.ozon_product_id,
        "ozon_sku": part.ozon_sku,
    }


def serialize_part_full(part: Part) -> dict:
    data = serialize_part_short(part)
    data.update({
        "description": part.description,
        "barcode": part.barcode,
        "category_id": part.category_id,
        "category_name": part.category_name,
        "weight": part.weight,
        "weight_unit": part.weight_unit,
        "dimensions": {
            "depth": part.depth,
            "width": part.width,
            "height": part.height,
            "unit": part.dimension_unit,
        },
        "moderate_status": part.moderate_status,
        "images": [
            {
                "uid": img.uid,
                "url": img.url,
                "sort_order": img.sort_order,
                "is_primary": img.is_primary,
            }
            for img in sorted(part.images, key=lambda x: x.sort_order)
        ],
        "attributes": [
            {"id": a.ozon_attribute_id, "value": a.value}
            for a in part.attributes
            if a.value and a.ozon_attribute_id in ALLOWED_ATTRIBUTE_IDS
        ],
        "stocks": [
            {
                "warehouse": s.warehouse_name,
                "present": s.present,
                "reserved": s.reserved,
                "type": s.stock_type,
            }
            for s in part.stocks
        ],
        "last_synced_at": part.last_synced_at.isoformat() if part.last_synced_at else None,
        "last_edited_at": part.last_edited_at.isoformat() if part.last_edited_at else None,
    })
    return data


def get_part_or_404(db: Session, part_id: int) -> Part:
    part = db.query(Part).filter(Part.id == part_id).one_or_none()
    if part is None:
        raise HTTPException(status_code=404, detail="Товар не найден")
    return part


def log_admin_action(db: Session, part_id: int, action: str, details: Optional[dict] = None):
    db.add(AdminAuditLog(part_id=part_id, action=action, details=details))


_NON_ALNUM_RE = re.compile(r"[^0-9a-zа-яё]")


def _normalize_code(text: str) -> str:
    """Для сравнения артикулов/OEM-номеров: нижний регистр, без пробелов, дефисов,
    точек, слэшей и прочих разделителей ("0155-305 363" == "0155305363")."""
    return _NON_ALNUM_RE.sub("", (text or "").lower())


def _sql_normalize(column):
    return func.regexp_replace(func.lower(column), "[^0-9a-zа-яё]", "", "g")


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _code_variants(query_text: str) -> list:
    """Нормализованный запрос + варианты без приставки/суффикса "omg": у части
    товаров артикул (offer_id) вида "0155305363-omg", а OEM-номер в атрибуте —
    без "-omg", и наоборот: пользователь может ввести номер с "-omg"."""
    code = _normalize_code(query_text)
    if not code:
        return []
    variants = [code]
    if code.endswith("omg") and len(code) > 3:
        variants.append(code[:-3])
    if code.startswith("omg") and len(code) > 3:
        variants.append(code[3:])
    return variants


def _search_clause_and_rank(query_text: str):
    """(условие поиска, выражение сортировки "точные совпадения первыми").

    Ищем по названию (как раньше, подстрока без учёта регистра), по артикулу
    offer_id и по OEM-номерам из атрибута #9048 (там может быть несколько
    номеров через "; "). Артикул и OEM-номера сравниваются нормализованно —
    без регистра, пробелов и разделителей, и с учётом/без "-omg" — так что
    поиск по "0155305363" находит товар с артикулом "0155305363-omg".
    Точное совпадение с offer_id (без omg) или с одним из OEM-номеров
    поднимается выше простого вхождения подстроки.
    """
    name_like = f"%{_escape_like(query_text.strip())}%"
    conditions = [Part.name.ilike(name_like, escape="\\")]
    exact_conditions = []

    offer_norm = _sql_normalize(Part.offer_id)
    # offer_id без "omg" (приставка/суффикс) — для точного сравнения
    offer_stripped = func.regexp_replace(offer_norm, "(^omg|omg$)", "", "g")
    oem_norm = _sql_normalize(PartAttribute.value)

    for code in _code_variants(query_text):
        code_like = f"%{code}%"
        conditions.append(offer_norm.like(code_like))
        conditions.append(
            Part.attributes.any(
                and_(
                    PartAttribute.ozon_attribute_id == ARTICLE_ATTRIBUTE_ID,
                    oem_norm.like(code_like),
                )
            )
        )
        exact_conditions.append(offer_norm == code)
        exact_conditions.append(offer_stripped == code)

    # OEM-номера в атрибуте перечислены через "; " — после нормализации
    # остаётся только ";" между ними, и точное совпадение = ";код;" внутри.
    # Разделитель сохраняем отдельной нормализацией (без удаления ";").
    oem_with_sep = func.regexp_replace(func.lower(PartAttribute.value), "[^0-9a-zа-яё;]", "", "g")
    for code in _code_variants(query_text):
        exact_conditions.append(
            Part.attributes.any(
                and_(
                    PartAttribute.ozon_attribute_id == ARTICLE_ATTRIBUTE_ID,
                    func.concat(";", oem_with_sep, ";").like(f"%;{code};%"),
                )
            )
        )

    rank = case((or_(*exact_conditions), 0), else_=1) if exact_conditions else None
    return or_(*conditions), rank


def _omegation_brand_clause():
    """EXISTS-условие: у товара есть атрибут бренда со значением Omegation."""
    return Part.attributes.any(
        and_(
            PartAttribute.ozon_attribute_id == BRAND_ATTRIBUTE_ID,
            PartAttribute.value.ilike(f"%{BRAND_FILTER_VALUE}%"),
        )
    )


@app.get("/parts")
def list_parts(
    db: Session = Depends(get_db),
    search: Optional[str] = Query(None),
    in_stock_only: bool = Query(False),
    include_archived: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=100),
):
    """Публичная витрина: всегда только товары с атрибутом бренда Omegation.
    Поиск идёт по названию, артикулу (offer_id, с "-omg" и без) и по OEM-номерам
    из атрибута #9048 — см. _search_clause_and_rank."""
    query = db.query(Part)
    if not include_archived:
        query = query.filter(Part.is_archived.is_(False))
    if in_stock_only:
        query = query.filter(Part.has_stock.is_(True))

    query = query.filter(_omegation_brand_clause())

    ordering = [Part.updated_at.desc()]
    if search and search.strip():
        clause, rank = _search_clause_and_rank(search)
        query = query.filter(clause)
        if rank is not None:
            ordering.insert(0, rank)

    total = query.count()
    items = (
        query.order_by(*ordering)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"total": total, "page": page, "page_size": page_size,
            "items": [serialize_part_short(p) for p in items]}


@app.get("/parts/{part_id}")
def get_part(part_id: int, db: Session = Depends(get_db)):
    return serialize_part_full(get_part_or_404(db, part_id))


@app.get("/brands")
def list_brands(db: Session = Depends(get_db)):
    rows = (
        db.query(Part.brand).filter(Part.brand.isnot(None))
        .distinct().order_by(Part.brand).all()
    )
    return {"brands": [r[0] for r in rows]}


@app.get("/sync/status")
def sync_status(db: Session = Depends(get_db)):
    # Публично — только статус синхронизации товаров с Ozon (как и раньше).
    # Импорт цен с FTP отдельный источник, виден только в /admin/sync/status.
    last = (
        db.query(SyncLog)
        .filter_by(source="ozon")
        .order_by(SyncLog.started_at.desc())
        .first()
    )
    if last is None:
        return {"status": "never_run"}
    return {
        "status": last.status,
        "started_at": last.started_at.isoformat(),
        "finished_at": last.finished_at.isoformat() if last.finished_at else None,
        "products_processed": last.products_processed,
        "products_failed": last.products_failed,
        "error_message": last.error_message,
    }


@app.get("/admin/parts", dependencies=[Depends(require_viewer)])
def admin_list_parts(
    db: Session = Depends(get_db),
    search: Optional[str] = Query(None),
    only_edited: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Показывает весь синхронизированный каталог — с синхронизацией,
    фильтрующей чужие бренды продавца на этапе записи (см. sync_ozon.py),
    это и есть только товары Omegation, без отдельного фильтра здесь."""
    query = db.query(Part)
    if only_edited:
        query = query.filter(Part.manual_override.is_(True))
    ordering = [Part.updated_at.desc()]
    if search and search.strip():
        clause, rank = _search_clause_and_rank(search)
        query = query.filter(clause)
        if rank is not None:
            ordering.insert(0, rank)

    total = query.count()
    items = (
        query.order_by(*ordering)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"total": total, "page": page, "page_size": page_size,
            "items": [serialize_part_short(p) for p in items]}


@app.get("/admin/parts/{part_id}", dependencies=[Depends(require_viewer)])
def admin_get_part(part_id: int, db: Session = Depends(get_db)):
    return serialize_part_full(get_part_or_404(db, part_id))


@app.patch("/admin/parts/{part_id}", dependencies=[Depends(require_editor)])
def admin_update_part_content(
    part_id: int, payload: PartContentUpdate, db: Session = Depends(get_db)
):
    part = get_part_or_404(db, part_id)

    changed = {}
    for field, value in payload.model_dump(exclude_unset=True).items():
        if getattr(part, field) != value:
            changed[field] = {"old": getattr(part, field), "new": value}
            setattr(part, field, value)

    if changed:
        part.manual_override = True
        part.last_edited_at = utcnow()
        log_admin_action(db, part.id, "update_content", changed)
        db.commit()
        db.refresh(part)

    return serialize_part_full(part)


@app.post("/admin/parts/{part_id}/revert-to-sync", dependencies=[Depends(require_editor)])
def admin_revert_to_sync(
    part_id: int, payload: RevertToSyncRequest, db: Session = Depends(get_db)
):
    part = get_part_or_404(db, part_id)
    part.manual_override = False
    part.last_edited_at = utcnow()
    log_admin_action(db, part.id, "revert_to_sync", {"confirm": payload.confirm})
    db.commit()
    db.refresh(part)
    return serialize_part_full(part)


async def _read_and_store_image(file: UploadFile) -> str:
    """Читает загруженный файл, проверяет, что это реальное JPEG/PNG/WEBP, и
    сохраняет в UPLOAD_DIR под случайным именем. Возвращает имя файла."""
    raw_bytes = await file.read(MAX_UPLOAD_SIZE_BYTES + 1)
    if len(raw_bytes) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="Файл больше 10 МБ")

    # Критичная проверка: реальный формат файла определяется Pillow по содержимому,
    # а не заявленному Content-Type или расширению из имени файла. Файлы, которые
    # Pillow не распознаёт как изображение (например, SVG с <script>, HTML), отклоняются.
    # DecompressionBombError отдельно — это "картинка-бомба": маленький файл (проходит
    # лимит 10 МБ по размеру на диске), который распаковывается в огромное число
    # пикселей и может забрать всю память/CPU процесса при декодировании.
    try:
        with Image.open(io.BytesIO(raw_bytes)) as probe:
            probe.verify()
        with Image.open(io.BytesIO(raw_bytes)) as probe:
            image_format = probe.format
    except Image.DecompressionBombError:
        raise HTTPException(
            status_code=400,
            detail="Изображение слишком большое по числу пикселей",
        )
    except (UnidentifiedImageError, OSError):
        raise HTTPException(
            status_code=400,
            detail="Файл не является корректным изображением JPEG, PNG или WEBP",
        )

    if image_format not in ALLOWED_IMAGE_FORMATS:
        raise HTTPException(status_code=400, detail="Разрешены только JPEG, PNG, WEBP")

    extension = ALLOWED_IMAGE_FORMATS[image_format]
    safe_name = f"{uuid.uuid4().hex}{extension}"
    (UPLOAD_DIR / safe_name).write_bytes(raw_bytes)
    return safe_name


def _remove_file_if_unreferenced(db: Session, file_name: Optional[str]):
    """Удаляет файл с диска, только если на него не ссылается ни одна строка
    PartImage (файлы, скачанные с Ozon, могут быть общими у нескольких карточек)."""
    if not file_name:
        return
    still_used = db.query(PartImage.id).filter(PartImage.file_name == file_name).first()
    if still_used is None:
        _image_file_path(file_name).unlink(missing_ok=True)


def _get_part_image_by_uid(db: Session, part: Part, uid: str) -> PartImage:
    image = db.query(PartImage).filter_by(part_id=part.id, uid=uid).one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Изображение не найдено у этого товара")
    return image


@app.post("/admin/parts/{part_id}/images/upload", dependencies=[Depends(require_editor)])
async def admin_upload_image(
    part_id: int,
    file: UploadFile = File(...),
    set_as_primary: bool = Query(False),
    db: Session = Depends(get_db),
):
    part = get_part_or_404(db, part_id)
    file_name = await _read_and_store_image(file)

    uid = new_image_uid()
    public_url = f"{PUBLIC_IMAGE_PREFIX}/{uid}"
    max_order = db.query(PartImage).filter_by(part_id=part.id).count()
    image = PartImage(part_id=part.id, uid=uid, url=public_url, file_name=file_name,
                       sort_order=max_order, is_primary=set_as_primary)
    db.add(image)

    if set_as_primary or part.primary_image is None:
        part.primary_image = public_url

    part.manual_override = True
    part.last_edited_at = utcnow()
    log_admin_action(db, part.id, "add_image", {"url": public_url, "source": "upload"})
    db.commit()

    return serialize_part_full(part)


@app.post("/admin/parts/{part_id}/images/{uid}/replace", dependencies=[Depends(require_editor)])
async def admin_replace_image(
    part_id: int,
    uid: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Заменяет файл у существующего фото. uid и публичный адрес остаются
    прежними — ссылки на это фото не ломаются."""
    part = get_part_or_404(db, part_id)
    image = _get_part_image_by_uid(db, part, uid)

    new_file_name = await _read_and_store_image(file)
    old_file_name = image.file_name
    image.file_name = new_file_name
    image.source_url = None  # теперь это загруженный вручную файл, не Ozon

    part.manual_override = True
    part.last_edited_at = utcnow()
    log_admin_action(db, part.id, "replace_image", {"url": image.url, "source": "upload"})
    db.commit()

    _remove_file_if_unreferenced(db, old_file_name)
    return serialize_part_full(part)


@app.post("/admin/parts/{part_id}/images/by-url", dependencies=[Depends(require_editor)])
def admin_add_image_by_url(
    part_id: int, payload: AddImageByUrlRequest, db: Session = Depends(get_db)
):
    part = get_part_or_404(db, part_id)

    # Файл по внешней ссылке не скачиваем (это был бы запрос с сервера на
    # произвольный адрес), поэтому постоянный адрес фото перенаправляет на неё.
    uid = new_image_uid()
    public_url = f"{PUBLIC_IMAGE_PREFIX}/{uid}"
    max_order = db.query(PartImage).filter_by(part_id=part.id).count()
    image = PartImage(part_id=part.id, uid=uid, url=public_url, file_name=None,
                       source_url=payload.url, sort_order=max_order,
                       is_primary=payload.set_as_primary)
    db.add(image)

    if payload.set_as_primary or part.primary_image is None:
        part.primary_image = public_url

    part.manual_override = True
    part.last_edited_at = utcnow()
    log_admin_action(db, part.id, "add_image", {"url": public_url, "source": "url",
                                                "external_url": payload.url})
    db.commit()

    return serialize_part_full(part)


@app.delete("/admin/parts/{part_id}/images", dependencies=[Depends(require_editor)])
def admin_delete_image(
    part_id: int, image_url: str = Query(...), db: Session = Depends(get_db)
):
    part = get_part_or_404(db, part_id)
    image = (
        db.query(PartImage)
        .filter_by(part_id=part.id, url=image_url)
        .one_or_none()
    )
    if image is None:
        raise HTTPException(status_code=404, detail="Изображение не найдено у этого товара")

    removed_file_name = image.file_name
    db.delete(image)

    if part.primary_image == image_url:
        next_image = (
            db.query(PartImage)
            .filter_by(part_id=part.id)
            .filter(PartImage.url != image_url)
            .order_by(PartImage.sort_order)
            .first()
        )
        part.primary_image = next_image.url if next_image else None

    part.manual_override = True
    part.last_edited_at = utcnow()
    log_admin_action(db, part.id, "delete_image", {"url": image_url})
    db.commit()

    _remove_file_if_unreferenced(db, removed_file_name)
    return serialize_part_full(part)


@app.put("/admin/parts/{part_id}/images/reorder", dependencies=[Depends(require_editor)])
def admin_reorder_images(
    part_id: int, payload: ImageReorderRequest, db: Session = Depends(get_db)
):
    part = get_part_or_404(db, part_id)
    existing = {img.url: img for img in part.images}

    for item in payload.images:
        img = existing.get(item.url)
        if img is None:
            raise HTTPException(status_code=400, detail=f"Изображение не найдено: {item.url}")
        img.sort_order = item.sort_order
        img.is_primary = item.is_primary
        if item.is_primary:
            part.primary_image = item.url

    part.manual_override = True
    part.last_edited_at = utcnow()
    log_admin_action(db, part.id, "reorder_images", {"count": len(payload.images)})
    db.commit()

    return serialize_part_full(part)


@app.get("/admin/parts/{part_id}/audit-log", dependencies=[Depends(require_viewer)])
def admin_get_audit_log(part_id: int, db: Session = Depends(get_db)):
    get_part_or_404(db, part_id)
    logs = (
        db.query(AdminAuditLog)
        .filter_by(part_id=part_id)
        .order_by(AdminAuditLog.created_at.desc())
        .all()
    )
    return [
        {"action": l.action, "details": l.details, "created_at": l.created_at.isoformat()}
        for l in logs
    ]


@app.get("/admin/settings", dependencies=[Depends(require_viewer)])
def admin_get_settings(db: Session = Depends(get_db)):
    return _merged_site_content(db)


@app.put("/admin/settings", dependencies=[Depends(require_full)])
def admin_update_settings(payload: SiteContentUpdate, db: Session = Depends(get_db)):
    """Сохраняет редактируемый контент (шапка/о нас/контакты). Каждый переданный
    раздел (hero/about/contacts) целиком заменяет собой сохранённое значение —
    разделы, которых нет в запросе, не трогаются."""
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        row = db.query(SiteContent).filter_by(key=key).one_or_none()
        if row is None:
            row = SiteContent(key=key, value=value)
            db.add(row)
        else:
            row.value = value
        row.updated_at = utcnow()
    db.commit()
    return _merged_site_content(db)


# --- Синхронизация: статус, история, настройки, ручной запуск, self-check ---
# Раздел "Синхронизация" в админке (/admin/sync). Отдельно от публичного
# /sync/status — здесь больше деталей (фото, FTP-цены, история, настройки,
# self-check) и требуется admin-токен. Два независимых источника —
# "ozon" (товары/фото) и "ftp" (цены) — у каждого своя история и интервал.

def _serialize_sync_log(log: SyncLog) -> dict:
    details = log.details or {}
    return {
        "id": log.id,
        "source": log.source,
        "status": log.status,
        "trigger": details.get("trigger", "scheduled"),
        "started_at": log.started_at.isoformat() if log.started_at else None,
        "finished_at": log.finished_at.isoformat() if log.finished_at else None,
        "duration_seconds": (
            (log.finished_at - log.started_at).total_seconds()
            if log.started_at and log.finished_at else None
        ),
        "products_processed": log.products_processed,
        "products_failed": log.products_failed,
        "images_downloaded": details.get("images_downloaded"),
        "images_failed": details.get("images_failed"),
        "images_skipped": details.get("images_skipped"),
        "download_images_enabled": details.get("download_images_enabled"),
        # Товары чужих брендов продавца на Ozon — не сохраняются в БД вообще
        # (см. catalog_rules.py); removed — сколько таких карточек, оставшихся
        # от старой логики без этого фильтра, было удалено этим запуском.
        "skipped_other_brand": details.get("skipped_other_brand"),
        "removed_other_brand": details.get("removed_other_brand"),
        "ftp_matched": details.get("matched"),
        "ftp_unmatched": details.get("unmatched"),
        "ftp_unmatched_sample": details.get("unmatched_sample"),
        # Код с FTP совпал с ОЕМ-номером сразу у нескольких разных товаров —
        # цена никому не проставлена, см. docstring в ftp_price_sync.py.
        "ftp_ambiguous": details.get("ambiguous"),
        "ftp_ambiguous_sample": details.get("ambiguous_sample"),
        "error_message": log.error_message,
    }


def _serialize_sync_settings(settings: SyncSettings) -> dict:
    return {
        "interval_minutes": settings.interval_minutes,
        "auto_sync_enabled": settings.auto_sync_enabled,
        "download_images_enabled": settings.download_images_enabled,
        "ftp_enabled": settings.ftp_enabled,
        "ftp_interval_minutes": settings.ftp_interval_minutes,
        "ftp_host": settings.ftp_host,
        "ftp_port": settings.ftp_port,
        "ftp_user": settings.ftp_user,
        # Сам пароль наружу никогда не отдаётся — только признак, что он задан.
        "ftp_password_set": bool(settings.ftp_password),
        "ftp_remote_path": settings.ftp_remote_path,
        "ftp_use_tls": settings.ftp_use_tls,
        "updated_at": settings.updated_at.isoformat() if settings.updated_at else None,
    }


def _last_sync_log(db: Session, source: str):
    return (
        db.query(SyncLog)
        .filter_by(source=source)
        .order_by(SyncLog.started_at.desc())
        .first()
    )


def _next_run_at(last, enabled: bool, interval_minutes: int):
    if not enabled or last is None or last.status == "running":
        return None
    return (last.started_at + timedelta(minutes=interval_minutes)).isoformat()


@app.get("/admin/sync/status", dependencies=[Depends(require_viewer)])
def admin_sync_status(db: Session = Depends(get_db)):
    settings = get_or_create_sync_settings(db)
    last_ozon = _last_sync_log(db, "ozon")
    last_ftp = _last_sync_log(db, "ftp")

    return {
        "ozon": {
            "last_run": _serialize_sync_log(last_ozon) if last_ozon else None,
            "next_run_at": _next_run_at(last_ozon, settings.auto_sync_enabled, settings.interval_minutes),
        },
        "ftp": {
            "last_run": _serialize_sync_log(last_ftp) if last_ftp else None,
            "next_run_at": _next_run_at(last_ftp, settings.ftp_enabled, settings.ftp_interval_minutes),
        },
        "settings": _serialize_sync_settings(settings),
    }


@app.get("/admin/sync/history", dependencies=[Depends(require_viewer)])
def admin_sync_history(
    db: Session = Depends(get_db),
    source: Optional[str] = Query(None, pattern="^(ozon|ftp)$"),
    limit: int = Query(20, ge=1, le=100),
):
    query = db.query(SyncLog)
    if source:
        query = query.filter_by(source=source)
    logs = query.order_by(SyncLog.started_at.desc()).limit(limit).all()
    return [_serialize_sync_log(l) for l in logs]


@app.get("/admin/sync/settings", dependencies=[Depends(require_viewer)])
def admin_get_sync_settings(db: Session = Depends(get_db)):
    return _serialize_sync_settings(get_or_create_sync_settings(db))


@app.put("/admin/sync/settings", dependencies=[Depends(require_full)])
def admin_update_sync_settings(payload: SyncSettingsUpdate, db: Session = Depends(get_db)):
    settings = get_or_create_sync_settings(db)
    data = payload.model_dump(exclude_unset=True)
    # Пустая строка для пароля означает "не менять" — иначе форма, где поле
    # пароля оставили пустым, стёрла бы уже сохранённый пароль.
    if not data.get("ftp_password"):
        data.pop("ftp_password", None)
    for field, value in data.items():
        setattr(settings, field, value)
    settings.updated_at = utcnow()
    db.commit()
    db.refresh(settings)
    return _serialize_sync_settings(settings)


@app.post("/admin/sync/run", dependencies=[Depends(require_full)])
async def admin_trigger_sync(
    payload: SyncRunRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Запускает синхронизацию с Ozon немедленно, в фоне процесса api. Не
    мешает плановому запуску в sync_worker — оба пишут в один SyncLog/БД,
    поэтому перед стартом проверяем, что прямо сейчас ничего не выполняется."""
    last = _last_sync_log(db, "ozon")
    if last is not None and last.status == "running":
        elapsed = (utcnow() - last.started_at).total_seconds()
        if elapsed < 3600:
            raise HTTPException(status_code=409, detail="Синхронизация с Ozon уже выполняется")

    background_tasks.add_task(
        run_ozon_sync, download_images=payload.download_images, trigger="manual"
    )
    return {"status": "started"}


@app.post("/admin/sync/run-ftp", dependencies=[Depends(require_full)])
async def admin_trigger_ftp_sync(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Запускает импорт цен с FTP немедленно, в фоне процесса api."""
    last = _last_sync_log(db, "ftp")
    if last is not None and last.status == "running":
        elapsed = (utcnow() - last.started_at).total_seconds()
        if elapsed < 3600:
            raise HTTPException(status_code=409, detail="Импорт цен с FTP уже выполняется")

    background_tasks.add_task(run_ftp_price_sync, trigger="manual")
    return {"status": "started"}


@app.post("/admin/sync/ftp/test", dependencies=[Depends(require_full)])
def admin_test_ftp_connection(payload: FtpConnectionTestRequest, db: Session = Depends(get_db)):
    """Селфчек кнопки «Проверить соединение»: можно проверить значения прямо
    из формы, ещё не сохранённые — любое не переданное поле берётся из уже
    сохранённых настроек (так пароль не нужно вводить заново, если меняли
    только путь к файлу)."""
    settings = get_or_create_sync_settings(db)
    return test_ftp_connection(
        host=payload.ftp_host if payload.ftp_host is not None else settings.ftp_host,
        port=payload.ftp_port if payload.ftp_port is not None else settings.ftp_port,
        user=payload.ftp_user if payload.ftp_user is not None else settings.ftp_user,
        password=payload.ftp_password if payload.ftp_password else settings.ftp_password,
        remote_path=(
            payload.ftp_remote_path if payload.ftp_remote_path is not None else settings.ftp_remote_path
        ),
        use_tls=payload.ftp_use_tls if payload.ftp_use_tls is not None else settings.ftp_use_tls,
    )


@app.get("/admin/sync/selfcheck", dependencies=[Depends(require_viewer)])
def admin_sync_selfcheck(db: Session = Depends(get_db)):
    """Общая самопроверка раздела «Синхронизация»: ключи Ozon заданы, папка
    загрузок фото доступна на запись, FTP (если включён) отвечает и отдаёт
    файл, последняя синхронизация с Ozon завершилась без ошибок."""
    checks = []

    checks.append({"name": "База данных", "ok": True, "message": "Соединение установлено"})

    ozon_configured = bool(os.getenv("OZON_CLIENT_ID") and os.getenv("OZON_API_KEY"))
    checks.append({
        "name": "Ключи Ozon Seller API",
        "ok": ozon_configured,
        "message": "OZON_CLIENT_ID и OZON_API_KEY заданы" if ozon_configured
                   else "Не заданы OZON_CLIENT_ID / OZON_API_KEY в .env",
    })

    try:
        probe = UPLOAD_DIR / ".selfcheck"
        probe.write_text("ok")
        probe.unlink()
        checks.append({"name": "Папка загрузок (фото)", "ok": True, "message": str(UPLOAD_DIR)})
    except OSError as exc:
        checks.append({"name": "Папка загрузок (фото)", "ok": False, "message": str(exc)})

    settings = get_or_create_sync_settings(db)
    if settings.ftp_enabled:
        result = test_ftp_connection(
            settings.ftp_host, settings.ftp_port, settings.ftp_user,
            settings.ftp_password, settings.ftp_remote_path, settings.ftp_use_tls,
        )
        checks.append({"name": "FTP-сервер с ценами", "ok": result["ok"], "message": result["message"]})
    else:
        checks.append({"name": "FTP-сервер с ценами", "ok": None, "message": "Импорт с FTP выключен в настройках"})

    last_ozon = _last_sync_log(db, "ozon")
    if last_ozon is not None:
        checks.append({
            "name": "Последняя синхронизация с Ozon",
            "ok": last_ozon.status in ("success", "success_with_errors"),
            "message": f"{last_ozon.status} — {last_ozon.started_at.isoformat()}",
        })

    return {"checks": checks, "ok": all(c["ok"] is not False for c in checks)}


# --- Авторизация и управление пользователями ---
# Именные учётные записи с ролями (viewer/editor/full) вместо общего
# ADMIN_TOKEN — см. admin_auth.py. Первая учётная запись создаётся из
# командной строки через manage_users.py (см. README) — веб-логина ещё нет,
# пока в базе нет ни одного пользователя.

def _serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


LOGIN_WINDOW_MINUTES = int(os.getenv("LOGIN_WINDOW_MINUTES", "15"))
LOGIN_MAX_FAILS_PER_IP = int(os.getenv("LOGIN_MAX_FAILS_PER_IP", "10"))
LOGIN_MAX_FAILS_PER_USER = int(os.getenv("LOGIN_MAX_FAILS_PER_USER", "10"))
LOGIN_LOG_RETENTION_DAYS = 30


def _lock_remaining_seconds(db: Session, column, value: str, threshold: int, now: datetime) -> int:
    """Если за окно набралось >= threshold неудач по ключу (IP или логин) —
    сколько секунд осталось до снятия блокировки, иначе 0. Блокировка
    «скользящая»: снимается, когда самая старая из последних threshold неудач
    выходит за окно."""
    window = timedelta(minutes=LOGIN_WINDOW_MINUTES)
    rows = (
        db.query(LoginAttempt.created_at)
        .filter(
            column == value,
            LoginAttempt.success.is_(False),
            LoginAttempt.created_at >= now - window,
        )
        .order_by(LoginAttempt.created_at.desc())
        .limit(threshold)
        .all()
    )
    if len(rows) < threshold:
        return 0
    unlock_at = rows[-1][0] + window
    return max(1, int((unlock_at - now).total_seconds()) + 1)


def _record_login_attempt(db: Session, username: str, ip: str, success: bool) -> None:
    db.add(LoginAttempt(username=username, ip=ip, success=success))
    db.commit()


@app.post("/admin/auth/login")
@limiter.limit("10/minute")
def admin_login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)):
    ip = client_ip(request)
    username = payload.username.strip()[:64]
    now = utcnow()

    # Блокировка перебора: по IP и по логину (второе — против распределённого
    # перебора с многих адресов). Считаются и попытки с несуществующими
    # логинами, поэтому по блокировке нельзя узнать, есть ли такой логин.
    # Заблокированные попытки в журнал не пишутся (иначе блокировка бы
    # продлевалась сама собой) и пароль не проверяется.
    remaining = max(
        _lock_remaining_seconds(db, LoginAttempt.ip, ip, LOGIN_MAX_FAILS_PER_IP, now),
        _lock_remaining_seconds(db, LoginAttempt.username, username, LOGIN_MAX_FAILS_PER_USER, now),
    )
    if remaining:
        logger.warning("login: блокировка перебора ip=%s username=%r, ещё %s с", ip, username, remaining)
        raise HTTPException(
            status_code=429,
            detail=f"Слишком много неудачных попыток входа. Повторите через {(remaining + 59) // 60} мин.",
            headers={"Retry-After": str(remaining)},
        )

    user = db.query(User).filter_by(username=username).one_or_none()
    # Одинаковое сообщение для "нет такого пользователя" и "неверный пароль",
    # и одинаковое время ответа в обоих случаях (verify_password_timing_safe
    # всегда считает PBKDF2, даже если пользователя не существует) — иначе
    # по разнице во времени ответа можно перебором узнать, какие логины
    # существуют. Плюс лимит 10/минуту на роут и блокировка выше.
    password_ok = verify_password_timing_safe(payload.password, user.password_hash if user else None)
    if user is None or not password_ok:
        _record_login_attempt(db, username, ip, False)
        logger.warning("login: неудачная попытка ip=%s username=%r", ip, username)
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    if not user.is_active:
        _record_login_attempt(db, username, ip, False)
        raise HTTPException(status_code=403, detail="Учётная запись отключена")

    # Хеш со старым числом итераций PBKDF2 — пересчитываем на текущее,
    # пока пароль в руках.
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
    token = create_session(db, user)
    user.last_login_at = now
    db.add(LoginAttempt(username=username, ip=ip, success=True))
    db.query(LoginAttempt).filter(
        LoginAttempt.created_at < now - timedelta(days=LOGIN_LOG_RETENTION_DAYS)
    ).delete(synchronize_session=False)
    db.commit()
    logger.info("login: успешный вход username=%r ip=%s", username, ip)
    return {"token": token, "user": _serialize_user(user)}


@app.post("/admin/auth/logout")
def admin_logout(authorization: str = Header(None), db: Session = Depends(get_db)):
    """Отзывает текущую сессию (удаляет её из БД — токен сразу перестаёт
    действовать). Не требует активной сессии в виде FastAPI-зависимости,
    чтобы logout не падал 401, если токен уже просрочен/невалиден —
    в таком случае просто нечего отзывать."""
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        revoke_session(db, token)
    return {"status": "ok"}


@app.get("/admin/auth/me")
def admin_me(user: User = Depends(get_current_user)):
    return _serialize_user(user)


@app.get("/admin/users", dependencies=[Depends(require_full)])
def admin_list_users(db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.username).all()
    return [_serialize_user(u) for u in users]


@app.post("/admin/users", dependencies=[Depends(require_full)])
def admin_create_user(payload: UserCreateRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter_by(username=payload.username).one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _serialize_user(user)


@app.patch("/admin/users/{user_id}")
def admin_update_user(
    user_id: int,
    payload: UserUpdateRequest,
    db: Session = Depends(get_db),
    current: User = Depends(require_full),
):
    target = db.query(User).filter_by(id=user_id).one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    data = payload.model_dump(exclude_unset=True)

    # Самоблокировка: нельзя деактивировать себя или понизить себя с full —
    # иначе можно случайно остаться без единственного администратора.
    if target.id == current.id:
        if data.get("is_active") is False:
            raise HTTPException(status_code=400, detail="Нельзя отключить собственную учётную запись")
        if "role" in data and data["role"] != "full" and current.role == "full":
            raise HTTPException(status_code=400, detail="Нельзя понизить собственную роль с «full»")

    revoke = False
    if "role" in data:
        target.role = data["role"]
    if "is_active" in data:
        target.is_active = data["is_active"]
        revoke = revoke or not data["is_active"]
    if data.get("password"):
        target.password_hash = hash_password(data["password"])
        revoke = True

    db.commit()
    # Смена пароля / отключение учётной записи сразу закрывают все её сессии:
    # украденный токен после смены пароля перестаёт работать.
    if revoke:
        revoke_user_sessions(db, target.id)
    db.refresh(target)
    return _serialize_user(target)
