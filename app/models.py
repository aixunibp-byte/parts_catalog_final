"""
SQLAlchemy-модели каталога автозапчастей.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, BigInteger, String, Numeric, Boolean,
    DateTime, ForeignKey, Text, JSON
)
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()


def utcnow():
    return datetime.now(timezone.utc)


class Part(Base):
    __tablename__ = "parts"

    id = Column(Integer, primary_key=True)
    ozon_product_id = Column(BigInteger, unique=True, nullable=False, index=True)
    ozon_sku = Column(BigInteger, index=True, nullable=True)
    offer_id = Column(String(255), unique=True, nullable=False, index=True)

    name = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    brand = Column(String(255), nullable=True, index=True)
    barcode = Column(String(64), nullable=True)

    category_id = Column(BigInteger, nullable=True)
    category_name = Column(String(255), nullable=True)

    price = Column(Numeric(12, 2), nullable=True)
    old_price = Column(Numeric(12, 2), nullable=True)
    currency_code = Column(String(8), default="RUB")

    weight = Column(Integer, nullable=True)
    weight_unit = Column(String(8), nullable=True)
    depth = Column(Integer, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    dimension_unit = Column(String(8), nullable=True)

    moderate_status = Column(String(32), nullable=True)
    is_archived = Column(Boolean, default=False)
    has_stock = Column(Boolean, default=False)

    # Постоянный URL главного фото (/api/images/<uid>) — тот же, что PartImage.url
    primary_image = Column(String(1000), nullable=True)
    # Исходная ссылка Ozon на главное изображение — хранится для сверки и ре-скачивания
    primary_image_source_url = Column(String(1000), nullable=True)

    # Цена, полученная последним импортом с FTP (по артикулу = offer_id).
    # Если заполнена — синхронизация с Ozon больше не трогает part.price,
    # цена с FTP считается приоритетной до тех пор, пока товар не пропадёт
    # из файла на FTP (тогда ftp_price сбрасывается, см. ftp_price_sync.py).
    ftp_price = Column(Numeric(12, 2), nullable=True)
    ftp_price_updated_at = Column(DateTime(timezone=True), nullable=True)

    manual_override = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    last_edited_at = Column(DateTime(timezone=True), nullable=True)

    images = relationship("PartImage", back_populates="part", cascade="all, delete-orphan")
    attributes = relationship("PartAttribute", back_populates="part", cascade="all, delete-orphan")
    stocks = relationship("PartStock", back_populates="part", cascade="all, delete-orphan")


def new_image_uid() -> str:
    return uuid.uuid4().hex


class PartImage(Base):
    """Одно "место" под фото в карточке.

    uid и url — постоянный публичный адрес этого места (/api/images/<uid>),
    выдаётся один раз при создании и дальше НЕ меняется, даже если сам файл
    заменили (из админки или потому что на Ozon поменяли фото на этой позиции) —
    меняется только file_name. Так ссылки на фото, сохранённые где-то снаружи,
    не ломаются при замене картинки.
    """
    __tablename__ = "part_images"

    id = Column(Integer, primary_key=True)
    part_id = Column(Integer, ForeignKey("parts.id", ondelete="CASCADE"), nullable=False)
    uid = Column(String(32), unique=True, nullable=False, index=True, default=new_image_uid)
    # Постоянный публичный URL вида /api/images/<uid> (см. main.py: get_image).
    url = Column(String(1000), nullable=False)
    # Имя файла в UPLOAD_DIR с текущим содержимым. None — у фото, добавленного
    # админом "по ссылке": тогда /api/images/<uid> перенаправляет на source_url.
    file_name = Column(String(255), nullable=True)
    # Исходная ссылка Ozon (или внешняя ссылка, добавленная админом по URL),
    # с которой взято изображение. None, если файл загружен вручную админом.
    source_url = Column(String(1000), nullable=True)
    sort_order = Column(Integer, default=0)
    is_primary = Column(Boolean, default=False)

    part = relationship("Part", back_populates="images")


class PartAttribute(Base):
    __tablename__ = "part_attributes"

    id = Column(Integer, primary_key=True)
    part_id = Column(Integer, ForeignKey("parts.id", ondelete="CASCADE"), nullable=False)
    ozon_attribute_id = Column(BigInteger, nullable=False)
    name = Column(String(500), nullable=True)
    value = Column(Text, nullable=True)
    dictionary_value_id = Column(BigInteger, nullable=True)

    part = relationship("Part", back_populates="attributes")


class PartStock(Base):
    __tablename__ = "part_stocks"

    id = Column(Integer, primary_key=True)
    part_id = Column(Integer, ForeignKey("parts.id", ondelete="CASCADE"), nullable=False)
    warehouse_name = Column(String(255), nullable=True)
    present = Column(Integer, default=0)
    reserved = Column(Integer, default=0)
    stock_type = Column(String(32), nullable=True)

    part = relationship("Part", back_populates="stocks")


class SyncLog(Base):
    __tablename__ = "sync_log"

    id = Column(Integer, primary_key=True)
    # "ozon" — синхронизация товаров/фото с Ozon; "ftp" — импорт цен с FTP.
    source = Column(String(16), nullable=False, default="ozon", server_default="ozon")
    started_at = Column(DateTime(timezone=True), default=utcnow)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(32), default="running")
    products_processed = Column(Integer, default=0)
    products_failed = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    details = Column(JSON, nullable=True)


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"

    id = Column(Integer, primary_key=True)
    part_id = Column(Integer, ForeignKey("parts.id", ondelete="CASCADE"), nullable=False)
    action = Column(String(64), nullable=False)
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class SiteContent(Base):
    """Редактируемые текстовые блоки сайта (главная/о нас/контакты),
    хранятся как key -> JSON-значение. Ключи: hero, about, contacts."""
    __tablename__ = "site_content"

    key = Column(String(32), primary_key=True)
    value = Column(JSON, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class SyncSettings(Base):
    """Настройки синхронизации с Ozon — единственная строка (id=1).

    Читается воркером (scheduler.py) на каждой итерации опроса, поэтому
    изменения из админки применяются без перезапуска контейнеров.
    """
    __tablename__ = "sync_settings"

    id = Column(Integer, primary_key=True, default=1)
    # Периодичность автосинхронизации, минуты
    interval_minutes = Column(Integer, nullable=False, default=60)
    # Общий выключатель автосинхронизации по расписанию
    auto_sync_enabled = Column(Boolean, nullable=False, default=True)
    # Скачивать ли фото карточек на сервер во время синхронизации.
    # Если выключено — синхронизируются только данные (цена/остатки/атрибуты),
    # part.primary_image и галерея PartImage не трогаются.
    download_images_enabled = Column(Boolean, nullable=False, default=True)

    # --- Импорт цен с FTP (артикул=offer_id, цена — приоритетнее цены Ozon) ---
    ftp_enabled = Column(Boolean, nullable=False, default=False, server_default="false")
    ftp_interval_minutes = Column(Integer, nullable=False, default=1440, server_default="1440")
    ftp_host = Column(String(255), nullable=True)
    ftp_port = Column(Integer, nullable=False, default=21, server_default="21")
    ftp_user = Column(String(255), nullable=True)
    # Хранится как есть (не хешируется — пароль нужен в открытом виде для
    # подключения к FTP). Наружу через API никогда не отдаётся, только
    # признак ftp_password_set. Доступ к этой таблице — только у пользователей
    # с ролью full (см. admin_auth.py), тот же уровень доверия, что у .env
    # на сервере.
    ftp_password = Column(String(500), nullable=True)
    ftp_remote_path = Column(String(1000), nullable=True)
    ftp_use_tls = Column(Boolean, nullable=False, default=False, server_default="false")

    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class User(Base):
    """Учётная запись админки. Роль — минимальный уровень доступа:
    viewer (только просмотр) < editor (+ редактирование карточек товаров)
    < full (+ настройки сайта, синхронизация, управление пользователями).
    См. ROLE_LEVELS в admin_auth.py."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(16), nullable=False, default="viewer")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    sessions = relationship("UserSession", back_populates="user", cascade="all, delete-orphan")


class UserSession(Base):
    """Активная сессия после логина. Хранится хеш токена (SHA-256), не сам
    токен — как и раньше с ADMIN_TOKEN, восстановить токен из БД нельзя.
    Удаление строки = мгновенный отзыв (logout, деактивация пользователя)."""
    __tablename__ = "user_sessions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="sessions")


class LoginAttempt(Base):
    """Журнал попыток входа в админку (успешных и неудачных): по нему
    считается временная блокировка перебора пароля и разбираются инциденты.
    Записи старше 30 дней удаляются при очередном успешном входе."""
    __tablename__ = "login_attempts"

    id = Column(Integer, primary_key=True)
    username = Column(String(64), nullable=False, index=True)
    ip = Column(String(64), nullable=False, index=True)
    success = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, index=True)
