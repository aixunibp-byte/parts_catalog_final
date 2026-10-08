"""
Общие механизмы защиты бэкенда.

1. client_ip() — реальный IP посетителя. Приложение стоит за nginx, поэтому
   request.client.host — это адрес контейнера nginx, один на всех. Раньше
   лимиты запросов (slowapi) считались по этому адресу: у ВСЕХ посетителей
   сайта был один общий счётчик, а блокировка перебора пароля на логине
   срабатывала для всех сразу. Теперь адрес берётся из X-Real-IP, но только
   если запрос пришёл от доверенного прокси (адрес из частной сети docker,
   порт api наружу не публикуется) — иначе заголовок мог бы подделать любой.

2. Секретный адрес входа в админку (ADMIN_URL_UID). Все пути /admin/* API
   отвечают 404 (как несуществующие), пока в заголовке X-Admin-Uid нет
   правильного значения. Само значение в сборку фронтенда НЕ вшито: админ
   открывает страницу /console/<uid>/login, фронтенд берёт uid из адресной
   строки и сам подставляет его в заголовок. Повторные запросы с неверным uid
   с одного IP приводят к временному бану (AdminGateMiddleware в main.py).

3. Политика паролей, бан по числу неудач в памяти, проверка исходящих
   подключений (защита от SSRF через настройки FTP).
"""
import hmac
import ipaddress
import logging
import os
import re
import socket
import threading
import time
from collections import defaultdict, deque
from typing import Optional

logger = logging.getLogger("security")

# ---------------------------------------------------------------------------
# IP клиента
# ---------------------------------------------------------------------------


def _is_trusted_proxy(peer: str) -> bool:
    """Доверяем заголовкам прокси только от адресов из частных сетей и loopback
    (контейнер nginx в docker-сети). Порт api наружу не опубликован, поэтому
    достучаться до него из публичного интернета в обход nginx нельзя."""
    try:
        addr = ipaddress.ip_address(peer)
    except ValueError:
        return False
    return addr.is_private or addr.is_loopback


def client_ip(request) -> str:
    peer = request.client.host if getattr(request, "client", None) else "unknown"
    if _is_trusted_proxy(peer):
        candidate = (request.headers.get("x-real-ip") or "").strip()
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            pass
    return peer


# ---------------------------------------------------------------------------
# Секретный адрес входа в админку
# ---------------------------------------------------------------------------

ADMIN_UID_ENV = "ADMIN_URL_UID"
ADMIN_UID_RE = re.compile(r"^[A-Za-z0-9_-]{24,64}$")


def configured_admin_uid() -> Optional[str]:
    value = (os.getenv(ADMIN_UID_ENV) or "").strip()
    return value if ADMIN_UID_RE.match(value) else None


def admin_gate_configured() -> bool:
    return configured_admin_uid() is not None


def check_admin_uid(provided: Optional[str]) -> bool:
    """Сравнение за постоянное время. Если ADMIN_URL_UID не задан или задан
    некорректно — админ-API закрыто для всех (fail closed)."""
    expected = configured_admin_uid()
    if not expected or not provided:
        return False
    return hmac.compare_digest(provided.strip().encode("utf-8"), expected.encode("utf-8"))


# ---------------------------------------------------------------------------
# Бан по числу неудач (в памяти процесса)
# ---------------------------------------------------------------------------


class FailureBan:
    """Скользящее окно неудач на ключ (IP). Достигнут порог — ключ в бане на
    ban_seconds. Состояние в памяти: сбрасывается при перезапуске api, а
    постоянный журнал попыток входа ведётся отдельно, в БД (login_attempts)."""

    def __init__(self, max_failures: int, window_seconds: int, ban_seconds: int):
        self.max_failures = max_failures
        self.window = window_seconds
        self.ban_seconds = ban_seconds
        self._failures = defaultdict(deque)
        self._banned_until = {}
        self._lock = threading.Lock()

    def _purge(self, now: float) -> None:
        if len(self._failures) > 5000:
            for key in list(self._failures):
                dq = self._failures[key]
                while dq and now - dq[0] > self.window:
                    dq.popleft()
                if not dq:
                    del self._failures[key]
        if len(self._banned_until) > 5000:
            for key in [k for k, t in self._banned_until.items() if t <= now]:
                del self._banned_until[key]

    def is_banned(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            until = self._banned_until.get(key)
            if until is None:
                return False
            if until <= now:
                del self._banned_until[key]
                return False
            return True

    def register_failure(self, key: str) -> bool:
        """Возвращает True, если именно эта неудача включила бан."""
        now = time.monotonic()
        with self._lock:
            self._purge(now)
            dq = self._failures[key]
            dq.append(now)
            while dq and now - dq[0] > self.window:
                dq.popleft()
            if len(dq) >= self.max_failures:
                self._banned_until[key] = now + self.ban_seconds
                dq.clear()
                return True
            return False


# ---------------------------------------------------------------------------
# Политика паролей
# ---------------------------------------------------------------------------

MIN_PASSWORD_LENGTH = 12

_COMMON_PASSWORDS = {
    "password", "password1", "password123", "123456789012", "1234567890123",
    "qwertyuiop12", "qwerty123456", "admin1234567", "administrator", "letmein12345",
    "iloveyou1234", "welcome12345", "omegation123", "omegation1234", "omegation12345",
    "йцукенгшщзх", "пароль123456",
}


def validate_password_strength(password: str, username: Optional[str] = None) -> Optional[str]:
    """None — пароль подходит, иначе текст причины (по-русски, для показа админу)."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Пароль должен быть не короче {MIN_PASSWORD_LENGTH} символов."
    lowered = password.lower()
    if lowered in _COMMON_PASSWORDS:
        return "Слишком распространённый пароль."
    if username and len(username) >= 3 and username.lower() in lowered:
        return "Пароль не должен содержать логин."
    if len(set(password)) < 5:
        return "Пароль слишком однообразный."
    classes = sum([
        any(c.islower() for c in password),
        any(c.isupper() for c in password),
        any(c.isdigit() for c in password),
        any(not c.isalnum() for c in password),
    ])
    if classes < 3 and len(password) < 20:
        return ("Используйте минимум три вида символов (строчные, заглавные, цифры, знаки) "
                "или пароль длиной от 20 символов.")
    return None


# ---------------------------------------------------------------------------
# Исходящие подключения (FTP): защита от SSRF
# ---------------------------------------------------------------------------

ALLOWED_PORTS = {21, 990}
ALLOW_PRIVATE_ENV = "OUTBOUND_ALLOW_PRIVATE"


class OutboundTargetError(ValueError):
    pass


def validate_outbound_target(host: str, port: Optional[int]) -> str:
    """Разрешает подключаться только к публичным адресам и осмысленным портам.

    Настройки FTP может менять администратор роли full, но если его учётная
    запись окажется скомпрометированной, «проверка соединения» превратилась бы
    в сканер внутренней сети сервера (db:5432, api:8000, метаданные облака
    169.254.169.254). Возвращает проверенный IP-адрес: подключаться нужно
    именно к нему, а не заново резолвить имя (иначе подмена DNS между
    проверкой и подключением — DNS rebinding — обошла бы защиту). Поэтому loopback/link-local/зарезервированные адреса
    запрещены всегда, а частные сети (10.x, 172.16-31.x, 192.168.x, CGNAT) —
    пока в .env не включено OUTBOUND_ALLOW_PRIVATE=1 (нужно, только если
    FTP-сервер действительно стоит во внутренней сети).
    """
    host = (host or "").strip()
    if not host or len(host) > 255 or re.search(r"[\s/\\@]", host):
        raise OutboundTargetError("Некорректный адрес FTP-сервера")
    effective_port = port or 21
    if not (effective_port in ALLOWED_PORTS or 1024 <= effective_port <= 65535):
        raise OutboundTargetError(
            "Порт FTP должен быть 21, 990 или из диапазона 1024–65535"
        )

    allow_private = os.getenv(ALLOW_PRIVATE_ENV, "0") == "1"
    try:
        infos = socket.getaddrinfo(host, effective_port, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise OutboundTargetError("Адрес FTP-сервера не удалось разрешить в IP")

    chosen = None
    for info in infos:
        addr = ipaddress.ip_address(info[4][0].split("%")[0])
        if (addr.is_loopback or addr.is_link_local or addr.is_multicast
                or addr.is_unspecified or addr.is_reserved):
            raise OutboundTargetError("Подключение к этому адресу запрещено")
        if not addr.is_global and not allow_private:
            raise OutboundTargetError(
                "Адрес из частной сети: подключение запрещено. Если FTP-сервер действительно "
                "во внутренней сети, включите OUTBOUND_ALLOW_PRIVATE=1 в .env"
            )
        if chosen is None:
            chosen = str(addr)
    if chosen is None:
        raise OutboundTargetError("Адрес FTP-сервера не удалось разрешить в IP")
    return chosen
