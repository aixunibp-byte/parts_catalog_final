"""
Периодический запуск синхронизации с Ozon и импорта цен с FTP.

Раньше интервал брался один раз при старте из SYNC_INTERVAL_MINUTES и был
неизменным до перезапуска контейнера. Теперь воркер каждую минуту опрашивает
таблицу sync_settings (редактируется из админки, раздел "Синхронизация") и
сам решает, пора ли запускать каждую из синхронизаций — так что смена
интервала или включение/выключение любой из них применяется без
перезапуска sync_worker. Ozon и FTP работают независимо, каждый по своему
интервалу.

SYNC_INTERVAL_MINUTES из .env используется только как дефолт при самом первом
запуске, когда строки настроек в БД ещё нет (см. get_or_create_sync_settings).
"""
import asyncio
import logging

from database import init_db, SessionLocal
from models import SyncLog
from sync_ozon import run_sync, get_or_create_sync_settings, _now
from ftp_price_sync import run_ftp_price_sync

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("scheduler")

POLL_INTERVAL_SECONDS = 60
STALE_RUNNING_SECONDS = 3600  # если "running" висит дольше часа — считаем зависшим


async def ozon_job():
    logger.info("Запуск плановой синхронизации с Ozon")
    try:
        await run_sync(trigger="scheduled")
    except Exception:
        logger.exception("Плановая синхронизация с Ozon завершилась с ошибкой")


async def ftp_job():
    logger.info("Запуск планового импорта цен с FTP")
    try:
        await run_ftp_price_sync(trigger="scheduled")
    except Exception:
        logger.exception("Плановый импорт цен с FTP завершился с ошибкой")


def _last_sync_state(source: str):
    """(seconds_since_started, status) последнего запуска указанного источника
    ("ozon"/"ftp"), либо (None, None), если ещё ни разу не запускался
    (тогда сразу запускаем)."""
    db = SessionLocal()
    try:
        last = (
            db.query(SyncLog)
            .filter_by(source=source)
            .order_by(SyncLog.started_at.desc())
            .first()
        )
        if last is None:
            return None, None
        return (_now() - last.started_at).total_seconds(), last.status
    finally:
        db.close()


def _is_due(source: str, interval_minutes: int) -> bool:
    elapsed, status = _last_sync_state(source)
    already_running = (
        status == "running" and elapsed is not None and elapsed < STALE_RUNNING_SECONDS
    )
    return (elapsed is None or elapsed >= interval_minutes * 60) and not already_running


async def main():
    init_db()
    logger.info("Планировщик запущен, опрос настроек каждые %d сек.", POLL_INTERVAL_SECONDS)

    while True:
        try:
            db = SessionLocal()
            try:
                settings = get_or_create_sync_settings(db)
                ozon_interval = settings.interval_minutes
                ozon_enabled = settings.auto_sync_enabled
                ftp_interval = settings.ftp_interval_minutes
                ftp_enabled = settings.ftp_enabled
            finally:
                db.close()

            if ozon_enabled and _is_due("ozon", ozon_interval):
                await ozon_job()

            if ftp_enabled and _is_due("ftp", ftp_interval):
                await ftp_job()
        except Exception:
            logger.exception("Ошибка в цикле планировщика")

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    asyncio.run(main())
