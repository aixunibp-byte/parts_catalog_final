#!/bin/bash
# Бэкап базы данных Postgres из docker-контейнера.
# Использование: ./backup.sh
# Для автоматического запуска — см. инструкцию в конце файла или в README.
set -euo pipefail

cd "$(dirname "$0")"

# Значения читаем из .env, чтобы не дублировать пароль/имя базы в этом скрипте
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -E '^(DB_USER|DB_NAME)=' | xargs)
fi

DB_USER="${DB_USER:-parts_app}"
DB_NAME="${DB_NAME:-parts_catalog}"

BACKUP_DIR="$(pwd)/backups"
KEEP_DAYS=14
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUT_FILE="${BACKUP_DIR}/parts_catalog_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "Делаю дамп базы ${DB_NAME}..."
docker compose exec -T db pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$OUT_FILE"

echo "Готово: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

# Удаляем бэкапы старше KEEP_DAYS дней, чтобы диск не переполнялся
find "$BACKUP_DIR" -name "parts_catalog_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete

echo "Бэкапов в наличии: $(ls "$BACKUP_DIR" | wc -l)"

# --- Как поставить на автозапуск раз в сутки ---
# 1. chmod +x backup.sh
# 2. crontab -e
# 3. Добавить строку (запуск каждый день в 3:30 ночи):
#    30 3 * * * /home/xxx/parts-catalog-main/backup.sh >> /home/xxx/parts-catalog-main/backups/backup.log 2>&1
#
# Бэкапы копятся в ./backups — по-хорошему периодически скачивай их на другую
# машину/в облако (scp, rclone и т.п.): бэкап на том же сервере, что и сама
# база, не спасает при отказе диска целиком.
