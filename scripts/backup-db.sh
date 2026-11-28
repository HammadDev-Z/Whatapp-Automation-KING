#!/bin/sh
# Daily PostgreSQL backup for the WhatsApp code bot. Intended to run from cron
# on the VPS (see README "Backup and restore"), not inside Docker.
set -eu

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups"
RETENTION_DAYS=14
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
TMP_FILE="$BACKUP_DIR/whatsapp_codes_$TIMESTAMP.dump.tmp"
FILE="$BACKUP_DIR/whatsapp_codes_$TIMESTAMP.dump"

mkdir -p "$BACKUP_DIR"
cd "$PROJECT_DIR"
trap 'rm -f "$TMP_FILE"' EXIT

docker compose exec -T postgres pg_dump -U postgres -d whatsapp_codes_king -Fc > "$TMP_FILE"
mv "$TMP_FILE" "$FILE"
echo "$(date '+%Y-%m-%d %H:%M:%S') Backup written: $FILE"

find "$BACKUP_DIR" -name 'whatsapp_codes_*.dump' -mtime +"$RETENTION_DAYS" -delete
