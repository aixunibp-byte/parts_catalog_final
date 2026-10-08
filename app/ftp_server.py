"""
Собственный FTP-сервер для загрузки прайс-листов (csv/xls/xlsx).

Запускается отдельным контейнером `ftp` (см. docker-compose.yml). Поставщик
или менеджер загружает таблицу по FTPS; импорт цен (ftp_price_sync.py) при
адресе «local» берёт файл из этой же папки — см. price_inbox.py.

Что ограничено намеренно (жёсткий контроль подключений):
  * одна учётная запись из переменных окружения (FTP_UPLOAD_USER /
    FTP_UPLOAD_PASSWORD), пароль проверяется за постоянное время и обязан
    проходить ту же политику, что пароли админки; без пароля сервер не стартует;
  * права только «список, смена каталога, запись» (elw): нельзя скачивать,
    удалять, переименовывать, создавать каталоги; изоляция (chroot) в папку
    прайсов;
  * принимаются только файлы *.csv, *.xls, *.xlsx с безопасным именем, только
    в корень папки; STOU/APPE отключены;
  * шифрование обязательно (FTPS, TLS 1.2+) — логин и пароль не уходят по сети
    открытым текстом. Свой сертификат кладётся в FTP_TLS_CERT/FTP_TLS_KEY, иначе
    создаётся самоподписанный. Простой FTP — только при FTP_ALLOW_PLAIN=1;
  * лимиты: одновременных подключений всего/с одного IP, 3 попытки пароля на
    соединение, бан IP на час после нескольких неудачных входов, таймаут
    простоя, квота папки и хранение только последних N файлов;
  * пассивные порты — узкий диапазон (FTP_PASV_PORTS), который открывается
    в файрволе вместе с портом 21.
"""
import datetime
import hmac
import logging
import os
import secrets
import ssl  # noqa: F401  (проверка, что в образе есть TLS)
import sys
from pathlib import Path

from pyftpdlib.authorizers import AuthenticationFailed, DummyAuthorizer
from pyftpdlib.handlers import FTPHandler, TLS_FTPHandler
from pyftpdlib.servers import FTPServer

import price_inbox
from security import FailureBan, validate_password_strength

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("ftp_server")

LISTEN_PORT = int(os.getenv("FTP_LISTEN_PORT", "2121"))
MAX_CONS = int(os.getenv("FTP_MAX_CONS", "20"))
MAX_CONS_PER_IP = int(os.getenv("FTP_MAX_CONS_PER_IP", "3"))
MAX_UPLOAD_BYTES = int(os.getenv("FTP_MAX_UPLOAD_MB", "50")) * 1024 * 1024
INBOX_QUOTA_BYTES = int(os.getenv("FTP_INBOX_QUOTA_MB", "500")) * 1024 * 1024
KEEP_FILES = int(os.getenv("FTP_KEEP_FILES", "20"))
IDLE_TIMEOUT = int(os.getenv("FTP_IDLE_TIMEOUT", "120"))
STATE_DIR = Path(os.getenv("FTP_STATE_DIR", "/state"))
PERMISSIONS = "elw"  # список, смена каталога, запись. Без чтения/удаления/переименования.

login_ban = FailureBan(
    max_failures=int(os.getenv("FTP_BAN_FAILURES", "5")),
    window_seconds=600,
    ban_seconds=int(os.getenv("FTP_BAN_SECONDS", "3600")),
)


class EnvAuthorizer(DummyAuthorizer):
    """Одна учётная запись; пароль сравнивается за постоянное время."""

    def __init__(self, username: str, password: str):
        super().__init__()
        self._username = username.encode("utf-8")
        self._password = password.encode("utf-8")

    def validate_authentication(self, username, password, handler):
        user_ok = hmac.compare_digest(username.encode("utf-8"), self._username)
        pass_ok = hmac.compare_digest(password.encode("utf-8"), self._password)
        if not (user_ok and pass_ok):
            raise AuthenticationFailed("Неверный логин или пароль")


def _inbox_total_bytes() -> int:
    return sum(size for _name, _mtime, size in price_inbox.list_files(price_inbox.INBOX_DIR))


def _prune_inbox() -> None:
    """Оставляем только KEEP_FILES последних прайсов — загрузить мусор «на
    века» нельзя, а удалять файлы по FTP у пользователя нет прав."""
    for name, _mtime, _size in price_inbox.list_files(price_inbox.INBOX_DIR)[KEEP_FILES:]:
        try:
            (price_inbox.INBOX_DIR / name).unlink()
            logger.info("удалён старый прайс %s", name)
        except OSError:
            pass


class PriceHandlerMixin:
    banner = "Omegation price upload"
    max_login_attempts = 3
    timeout = IDLE_TIMEOUT
    permit_foreign_addresses = False
    permit_privileged_ports = False
    auth_failed_timeout = 3

    def on_connect(self):
        if login_ban.is_banned(self.remote_ip):
            logger.warning("отказ забаненному IP %s", self.remote_ip)
            self.close()

    def on_login_failed(self, username, password):
        logger.warning("неудачный вход: ip=%s user=%r", self.remote_ip, username[:64])
        if login_ban.register_failure(self.remote_ip):
            logger.warning("IP %s забанен за подбор пароля", self.remote_ip)
            self.close()

    def on_login(self, username):
        logger.info("вход: ip=%s user=%r", self.remote_ip, username)

    def ftp_STOU(self, line):  # имя без расширения обошло бы фильтр
        self.respond("502 Команда отключена.")

    def ftp_STOR(self, file, mode="w"):
        if mode != "w":
            self.respond("550 Дозапись отключена.")
            return
        name = str(file).lstrip("/")
        if "/" in name or not price_inbox.is_allowed_name(name):
            self.respond("550 Допустимы только файлы .csv, .xls, .xlsx с простым именем в корне папки.")
            return
        if _inbox_total_bytes() > INBOX_QUOTA_BYTES:
            self.respond("552 Папка загрузки переполнена.")
            return
        return super().ftp_STOR(file, mode)

    def on_file_received(self, file):
        try:
            size = os.path.getsize(file)
            if size > MAX_UPLOAD_BYTES:
                os.remove(file)
                logger.warning("файл %s удалён: %s байт > лимита", file, size)
                return
            os.chmod(file, 0o640)
        except OSError as exc:
            logger.error("не удалось обработать %s: %s", file, exc)
            return
        logger.info("получен прайс %s (%s байт) от %s", os.path.basename(file), size, self.remote_ip)
        _prune_inbox()

    def on_incomplete_file_received(self, file):
        try:
            os.remove(file)
        except OSError:
            pass


class PlainHandler(PriceHandlerMixin, FTPHandler):
    pass


class SecureHandler(PriceHandlerMixin, TLS_FTPHandler):
    tls_control_required = True
    tls_data_required = True


def _ensure_certificate() -> tuple:
    cert = Path(os.getenv("FTP_TLS_CERT", "/tls/fullchain.pem"))
    key = Path(os.getenv("FTP_TLS_KEY", "/tls/privkey.pem"))
    if cert.is_file() and key.is_file():
        logger.info("TLS: сертификат %s", cert)
        return str(cert), str(key)

    # Самоподписанный сертификат — в томе состояния, чтобы отпечаток не менялся
    # при перезапусках (клиент один раз подтверждает его и дальше доверяет).
    cert, key = STATE_DIR / "selfsigned.pem", STATE_DIR / "selfsigned.key"
    if not (cert.is_file() and key.is_file()):
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID

        STATE_DIR.mkdir(parents=True, exist_ok=True)
        common_name = os.getenv("FTP_TLS_CN", "ftp.omegation.local")
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])
        now = datetime.datetime.now(datetime.timezone.utc)
        certificate = (
            x509.CertificateBuilder()
            .subject_name(name).issuer_name(name)
            .public_key(private_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=825))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(common_name)]), critical=False)
            .sign(private_key, hashes.SHA256())
        )
        key.write_bytes(private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        ))
        os.chmod(key, 0o600)
        cert.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
        logger.warning("TLS: создан самоподписанный сертификат %s (отпечаток подтвердите в клиенте)", cert)
    return str(cert), str(key)


def _parse_ports(value: str) -> range:
    first, _, last = value.partition("-")
    return range(int(first), int(last or first) + 1)


def main() -> None:
    username = (os.getenv("FTP_UPLOAD_USER") or "prices").strip()
    password = os.getenv("FTP_UPLOAD_PASSWORD") or ""
    problem = validate_password_strength(password, username)
    if problem:
        logger.error("FTP_UPLOAD_PASSWORD не задан или слабый (%s). Сервер не запущен.", problem)
        sys.exit(1)

    price_inbox.INBOX_DIR.mkdir(parents=True, exist_ok=True)
    authorizer = EnvAuthorizer(username, password)
    authorizer.add_user(username, secrets.token_urlsafe(24), str(price_inbox.INBOX_DIR), perm=PERMISSIONS)

    allow_plain = os.getenv("FTP_ALLOW_PLAIN", "0") == "1"
    if allow_plain:
        handler = PlainHandler
        logger.warning("FTP_ALLOW_PLAIN=1: шифрование выключено, пароль передаётся открытым текстом!")
    else:
        handler = SecureHandler
        handler.certfile, handler.keyfile = _ensure_certificate()
        try:
            from OpenSSL import SSL
            handler.ssl_options |= SSL.OP_NO_TLSv1 | SSL.OP_NO_TLSv1_1
        except Exception:  # noqa: BLE001
            logger.warning("не удалось отключить TLS 1.0/1.1 явно")

    handler.authorizer = authorizer
    handler.passive_ports = _parse_ports(os.getenv("FTP_PASV_PORTS", "30000-30009"))
    public_ip = (os.getenv("FTP_PUBLIC_IP") or "").strip()
    if public_ip:
        handler.masquerade_address = public_ip
    else:
        logger.warning("FTP_PUBLIC_IP не задан: пассивный режим не заработает через NAT/Docker")

    server = FTPServer(("0.0.0.0", LISTEN_PORT), handler)
    server.max_cons = MAX_CONS
    server.max_cons_per_ip = MAX_CONS_PER_IP
    logger.info("FTP(S) сервер на порту %s, пользователь %r, папка %s", LISTEN_PORT, username, price_inbox.INBOX_DIR)
    server.serve_forever()


if __name__ == "__main__":
    main()
