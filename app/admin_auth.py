"""
Авторизация админки: именные учётные записи с ролями вместо одного общего
токена (раньше — ADMIN_TOKEN на всех).

Роли, по возрастанию прав — каждая проверка требует минимальный уровень:
  viewer  — только просмотр: каталог в админке, карточки, история и
            настройки синхронизации, настройки сайта — без права их менять.
  editor  — viewer + редактирование карточек товаров (контент, фото,
            revert-to-sync).
  full    — editor + всё, что меняет общие данные сайта целиком:
            настройки сайта (шапка/о нас/контакты), настройки и запуск
            синхронизации (Ozon и FTP), управление пользователями.

Первый пользователь создаётся из командной строки (см. manage_users.py) —
через веб залогиниться некому, пока в базе нет ни одной учётной записи.

Пароли — PBKDF2-HMAC-SHA256 (только стандартная библиотека, без лишних
зависимостей и их нативной сборки в Docker), формат
"pbkdf2_sha256$<итерации>$<соль-hex>$<хеш-hex>".

Сессии — не JWT. При логине выдаётся случайный токен
(secrets.token_urlsafe), в БД хранится только его SHA-256-хеш — как раньше
с ADMIN_TOKEN, сам токен из БД восстановить нельзя. Это даёт мгновенный
отзыв сессии (logout, деактивация пользователя), чего стейтless JWT без
чёрного списка не даёт.
"""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import User, UserSession

ROLE_LEVELS = {"viewer": 0, "editor": 1, "full": 2}
# Длительность сессии: абсолютный потолок (с момента входа) и простой без
# запросов. Раньше сессия жила 30 дней — украденный токен работал месяц.
# Значения можно менять в .env без правки кода.
SESSION_ABSOLUTE_HOURS = int(os.getenv("SESSION_ABSOLUTE_HOURS", "12"))
SESSION_IDLE_MINUTES = int(os.getenv("SESSION_IDLE_MINUTES", "120"))
# Не более N одновременных сессий на пользователя: при новом входе самые
# старые закрываются (ограничивает ущерб от утёкших токенов).
MAX_SESSIONS_PER_USER = int(os.getenv("MAX_SESSIONS_PER_USER", "5"))
# OWASP (2023) для PBKDF2-HMAC-SHA256 рекомендует >= 600 000 итераций.
# Старые хеши (260 000) остаются рабочими и автоматически пересчитываются
# на новое число итераций при ближайшем успешном входе (needs_rehash).
PBKDF2_ITERATIONS = 600_000


def _now():
    return datetime.now(timezone.utc)


# --- Пароли ---

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt, hash_hex = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), hash_hex)
    except (ValueError, AttributeError):
        return False


def needs_rehash(stored: str) -> bool:
    """True, если хеш создан с меньшим числом итераций, чем текущее."""
    try:
        algorithm, iterations, _salt, _hash = stored.split("$")
        return algorithm != "pbkdf2_sha256" or int(iterations) < PBKDF2_ITERATIONS
    except (ValueError, AttributeError):
        return True


# Захардкоженный хеш несуществующего пароля — используется только затем,
# чтобы прогнать те же PBKDF2-итерации для логина с несуществующим именем
# пользователя. Без этого ответ на логин с неверным username приходит
# заметно быстрее (пропускается hash_password), чем с верным username и
# неверным паролем — по разнице во времени ответа можно перебором узнавать,
# какие логины существуют в системе (CWE-208 timing side-channel), даже
# при одинаковом тексте ошибки. См. использование в main.py: admin_login.
_DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))


def verify_password_timing_safe(password: str, stored: Optional[str]) -> bool:
    """Как verify_password, но при stored=None (пользователь не найден)
    всё равно выполняет полный PBKDF2-расчёт над фиктивным хешем — тратит
    то же время, что и настоящая проверка, и не выдаёт таймингом факт
    существования username."""
    if stored is None:
        verify_password(password, _DUMMY_PASSWORD_HASH)
        return False
    return verify_password(password, stored)


# --- Сессии ---

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(db: Session, user: User) -> str:
    token = secrets.token_urlsafe(32)
    now = _now()
    session = UserSession(
        user_id=user.id,
        token_hash=_hash_token(token),
        created_at=now,
        expires_at=now + timedelta(hours=SESSION_ABSOLUTE_HOURS),
        last_used_at=now,
    )
    db.add(session)
    db.flush()

    # Просроченные сессии этого пользователя + всё, что сверх лимита (оставляем
    # самые свежие MAX_SESSIONS_PER_USER, включая только что созданную).
    db.query(UserSession).filter(
        UserSession.user_id == user.id, UserSession.expires_at < now
    ).delete(synchronize_session=False)
    keep = (
        db.query(UserSession.id)
        .filter(UserSession.user_id == user.id)
        .order_by(UserSession.created_at.desc(), UserSession.id.desc())
        .limit(MAX_SESSIONS_PER_USER)
        .all()
    )
    keep_ids = [row[0] for row in keep]
    if keep_ids:
        db.query(UserSession).filter(
            UserSession.user_id == user.id, ~UserSession.id.in_(keep_ids)
        ).delete(synchronize_session=False)
    db.commit()
    return token


def revoke_session(db: Session, token: str) -> None:
    db.query(UserSession).filter_by(token_hash=_hash_token(token)).delete()
    db.commit()


def revoke_user_sessions(db: Session, user_id: int) -> int:
    """Закрывает все сессии пользователя (смена пароля, деактивация, подозрение
    на компрометацию). Возвращает число закрытых сессий."""
    count = db.query(UserSession).filter_by(user_id=user_id).delete(synchronize_session=False)
    db.commit()
    return count


def get_current_user(authorization: str = Header(None), db: Session = Depends(get_db)) -> User:
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Требуется заголовок Authorization: Bearer <token>",
        )
    token = authorization.removeprefix("Bearer ").strip()
    session = db.query(UserSession).filter_by(token_hash=_hash_token(token)).one_or_none()
    now = _now()
    if session is not None:
        idle_limit = now - timedelta(minutes=SESSION_IDLE_MINUTES)
        too_old = session.expires_at < now
        idle = session.last_used_at is not None and session.last_used_at < idle_limit
        if too_old or idle:
            db.delete(session)
            db.commit()
            session = None
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Сессия недействительна, войдите заново"
        )

    user = db.query(User).filter_by(id=session.user_id).one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Учётная запись отключена")

    # Не пишем в БД на каждый запрос: достаточно обновлять раз в минуту.
    if session.last_used_at is None or (now - session.last_used_at).total_seconds() > 60:
        session.last_used_at = now
        db.commit()
    return user


def require_role(min_role: str):
    """Фабрика FastAPI-зависимостей: require_role("editor") пропускает
    editor и full, require_role("full") — только full.
    Использование: dependencies=[Depends(require_role("editor"))]
    или user: User = Depends(require_role("full")), если нужен сам User."""
    min_level = ROLE_LEVELS[min_role]

    def checker(user: User = Depends(get_current_user)) -> User:
        if ROLE_LEVELS.get(user.role, -1) < min_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Недостаточно прав для этого действия",
            )
        return user

    return checker


# Готовые зависимости для трёх уровней — чтобы не писать require_role(...)
# на каждом роуте.
require_viewer = require_role("viewer")
require_editor = require_role("editor")
require_full = require_role("full")
