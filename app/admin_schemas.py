"""
Pydantic-схемы для админ-эндпоинтов.
"""
from typing import Optional, List
from pydantic import BaseModel, Field, field_validator, model_validator

from security import validate_password_strength

ALLOWED_URL_SCHEMES = ("http://", "https://")


class PartContentUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=500)
    description: Optional[str] = None
    brand: Optional[str] = Field(None, max_length=255)
    category_name: Optional[str] = Field(None, max_length=255)


class ImageReorderItem(BaseModel):
    url: str
    sort_order: int
    is_primary: bool = False


class ImageReorderRequest(BaseModel):
    images: List[ImageReorderItem]


class AddImageByUrlRequest(BaseModel):
    url: str
    set_as_primary: bool = False

    @field_validator("url")
    @classmethod
    def validate_url_scheme(cls, value: str) -> str:
        """Запрещает javascript:/data:/file: и другие опасные схемы —
        разрешены только обычные http/https ссылки на изображения."""
        if not value.lower().startswith(ALLOWED_URL_SCHEMES):
            raise ValueError("URL должен начинаться с http:// или https://")
        return value


class RevertToSyncRequest(BaseModel):
    confirm: bool = True


class HeroContent(BaseModel):
    title: str = Field(..., max_length=300)
    description: str = Field(..., max_length=2000)


class AboutSection(BaseModel):
    title: str = Field(..., max_length=200)
    text: str = Field(..., max_length=1500)
    honest_sign: bool = False


class AboutContent(BaseModel):
    tagline: str = Field(..., max_length=300)
    intro: str = Field(..., max_length=2000)
    sections: List[AboutSection]
    closing: str = Field(..., max_length=2000)


class ContactsContent(BaseModel):
    phone: str = Field("", max_length=100)
    email: str = Field("", max_length=200)
    address: str = Field("", max_length=300)
    hours: str = Field("", max_length=200)


class SiteContentUpdate(BaseModel):
    hero: Optional[HeroContent] = None
    about: Optional[AboutContent] = None
    contacts: Optional[ContactsContent] = None


class SyncSettingsUpdate(BaseModel):
    interval_minutes: Optional[int] = Field(None, ge=5, le=1440)
    auto_sync_enabled: Optional[bool] = None
    download_images_enabled: Optional[bool] = None

    # --- FTP-импорт цен ---
    ftp_enabled: Optional[bool] = None
    ftp_interval_minutes: Optional[int] = Field(None, ge=5, le=10080)
    ftp_host: Optional[str] = Field(None, max_length=255)
    ftp_port: Optional[int] = Field(None, ge=1, le=65535)
    ftp_user: Optional[str] = Field(None, max_length=255)
    # Пустая строка/None — пароль не меняется (оставить сохранённый).
    # Чтобы явно очистить пароль, фронтенд шлёт специальное значение —
    # см. adminApi.js/AdminSyncPage.jsx (флажок "изменить пароль").
    ftp_password: Optional[str] = Field(None, max_length=500)
    ftp_remote_path: Optional[str] = Field(None, max_length=1000)
    ftp_use_tls: Optional[bool] = None


class SyncRunRequest(BaseModel):
    # Позволяет для разового запуска пропустить скачивание фото (быстрая
    # синхронизация только данных), не трогая общую настройку.
    download_images: Optional[bool] = None


class FtpConnectionTestRequest(BaseModel):
    """Для кнопки "Проверить соединение" в админке: можно передать значения
    прямо из формы (ещё не сохранённые), чтобы проверить перед сохранением.
    Любое не переданное поле берётся из уже сохранённых настроек —
    полезно, чтобы проверить новый путь к файлу, не перепечатывая пароль."""
    ftp_host: Optional[str] = None
    ftp_port: Optional[int] = None
    ftp_user: Optional[str] = None
    ftp_password: Optional[str] = None
    ftp_remote_path: Optional[str] = None
    ftp_use_tls: Optional[bool] = None


ROLE_PATTERN = "^(viewer|editor|full)$"


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=200)


USERNAME_PATTERN = r"^[A-Za-z0-9._-]{3,64}$"


class UserCreateRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=64, pattern=USERNAME_PATTERN)
    password: str = Field(..., max_length=200)
    role: str = Field(..., pattern=ROLE_PATTERN)

    @model_validator(mode="after")
    def check_password_policy(self):
        problem = validate_password_strength(self.password, self.username)
        if problem:
            raise ValueError(problem)
        return self


class UserUpdateRequest(BaseModel):
    role: Optional[str] = Field(None, pattern=ROLE_PATTERN)
    is_active: Optional[bool] = None
    # Новый пароль — если передан, заменяет старый. Оставить пустым, чтобы не менять.
    password: Optional[str] = Field(None, max_length=200)

    @field_validator("password")
    @classmethod
    def check_password_policy(cls, value):
        if value:
            problem = validate_password_strength(value)
            if problem:
                raise ValueError(problem)
        return value
