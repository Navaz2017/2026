#!/usr/bin/env bash
# Enrolla backup: database + uploaded files (+ WhatsApp sessions). Run nightly from cron (see docs/deploy-t620.md).
#   ENV_FILE=/etc/enrolla/backend.env BACKUP_DIR=/var/backups/enrolla COPY_TO=/mnt/usb/enrolla ./ops/backup.sh
# KEEP_DAYS (default 14) controls how long old backups are kept. COPY_TO (optional) = a second disk/drive: copy a backup
# to a DIFFERENT physical disk, otherwise one dead disk loses everything.
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/enrolla/backend.env}"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is not set (set ENV_FILE or export it)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/enrolla}"
KEEP_DAYS="${KEEP_DAYS:-14}"
FILES_DIR="${LOCAL_STORAGE_DIR:-}"
WA_DIR="${WA_DATA_DIR:-}"

stamp="$(date +%Y%m%d-%H%M%S)"
dest="$BACKUP_DIR/$stamp"
mkdir -p "$dest"
trap 'echo "BACKUP FAILED - removing partial $dest" >&2; rm -rf -- "$dest"' ERR

# libpq rejects Prisma-style "?schema=public" query strings, so strip them
pg_dump --format=custom --no-owner --file "$dest/db.dump" "${DATABASE_URL%%\?*}"
[ -n "$FILES_DIR" ] && [ -d "$FILES_DIR" ] && tar -C "$FILES_DIR" -czf "$dest/files.tar.gz" .
[ -n "$WA_DIR" ] && [ -d "$WA_DIR" ] && tar -C "$WA_DIR" -czf "$dest/whatsapp-sessions.tar.gz" .

# prove the dump can be read back, then record checksums
pg_restore --list "$dest/db.dump" > /dev/null
( cd "$dest" && sha256sum -- * > SHA256SUMS )
chmod -R go-rwx "$dest"   # contains children's data: owner-only

if [ -n "${COPY_TO:-}" ]; then
  mkdir -p "$COPY_TO"
  if command -v rsync >/dev/null; then rsync -a "$dest" "$COPY_TO/"; else cp -a "$dest" "$COPY_TO/"; fi
fi

# keep the newest KEEP_DAYS days only
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '2*' -mtime "+$KEEP_DAYS" -exec rm -rf -- {} +
trap - ERR
echo "Backup OK: $dest ($(du -sh "$dest" | cut -f1))"
