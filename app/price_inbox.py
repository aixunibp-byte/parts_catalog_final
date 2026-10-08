"""
Встроенная папка для прайсов, в которую пишет собственный FTP-сервер
(ftp_server.py), а читает импорт цен (ftp_price_sync.py).

В настройках импорта (админка -> Синхронизация -> «Цены с FTP») достаточно
указать адрес сервера «local»: тогда файл берётся не с внешнего FTP, а из
этой папки. «Путь к файлу» — имя файла в папке; пусто или «*» — брать самый
свежий загруженный прайс (csv/xls/xlsx).

Модуль не зависит от pyftpdlib — им пользуется и api/sync_worker (где
pyftpdlib не нужен), и сам FTP-сервер.
"""
import os
import re
import time
from pathlib import Path
from typing import List, Optional, Tuple

INBOX_DIR = Path(os.getenv("PRICE_INBOX_DIR", "/inbox"))
LOCAL_HOST = "local"
ALLOWED_EXTENSIONS = (".csv", ".xls", ".xlsx")
# Файл, изменённый только что, возможно ещё догружается — не берём его в импорт.
MIN_FILE_AGE_SECONDS = int(os.getenv("PRICE_INBOX_MIN_AGE_SECONDS", "20"))
# Имя: буквы/цифры/подчёркивание в начале, затем буквы, цифры, пробел, . ( ) - _
# Никаких слэшей, «..», управляющих символов.
_NAME_RE = re.compile(r"^\w[\w .()\-]{0,99}$", re.UNICODE)


class InboxError(Exception):
    pass


def is_local_host(host: Optional[str]) -> bool:
    return (host or "").strip().lower() == LOCAL_HOST


def is_allowed_name(name: str) -> bool:
    if not name or ".." in name or not _NAME_RE.match(name):
        return False
    return name.lower().endswith(ALLOWED_EXTENSIONS)


def list_files(inbox: Optional[Path] = None) -> List[Tuple[str, float, int]]:
    """[(имя, mtime, размер)] для подходящих обычных файлов, свежие первыми."""
    inbox = Path(inbox or INBOX_DIR)
    result = []
    if not inbox.is_dir():
        return result
    for entry in inbox.iterdir():
        try:
            if entry.is_symlink() or not entry.is_file() or not is_allowed_name(entry.name):
                continue
            st = entry.stat()
        except OSError:
            continue
        result.append((entry.name, st.st_mtime, st.st_size))
    result.sort(key=lambda row: row[1], reverse=True)
    return result


def pick_file(remote_path: Optional[str], inbox: Optional[Path] = None,
              now: Optional[float] = None) -> Path:
    inbox = Path(inbox or INBOX_DIR)
    now = time.time() if now is None else now
    wanted = (remote_path or "").strip()
    files = list_files(inbox)

    if wanted in ("", "*"):
        if not files:
            raise InboxError("В папке загрузки FTP пока нет файлов прайса (csv, xls, xlsx)")
        name, mtime, _ = files[0]
    else:
        name = Path(wanted.replace("\\", "/")).name
        match = [row for row in files if row[0] == name]
        if not match:
            raise InboxError(f"Файл «{name}» не найден в папке загрузки FTP")
        mtime = match[0][1]

    if now - mtime < MIN_FILE_AGE_SECONDS:
        raise InboxError(f"Файл «{name}» только что загружен — повторите через минуту")
    return inbox / name


def describe_file(remote_path: Optional[str], inbox: Optional[Path] = None) -> dict:
    """Для кнопки «Проверить соединение»: найден ли файл, его размер и время."""
    path = pick_file(remote_path, inbox)
    st = path.stat()
    return {
        "name": path.name,
        "size_bytes": st.st_size,
        "modified_at": time.strftime("%Y%m%d%H%M%S", time.gmtime(st.st_mtime)),
    }


def read_file(remote_path: Optional[str], max_bytes: int, inbox: Optional[Path] = None) -> Tuple[str, bytes]:
    path = pick_file(remote_path, inbox)
    size = path.stat().st_size
    if size > max_bytes:
        raise InboxError(f"Файл «{path.name}» больше допустимого размера ({max_bytes // (1024 * 1024)} МБ)")
    with open(path, "rb") as fh:
        data = fh.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise InboxError(f"Файл «{path.name}» больше допустимого размера ({max_bytes // (1024 * 1024)} МБ)")
    return path.name, data
