#!/usr/bin/env bash
# Restore a backup made by backup.sh. DESTRUCTIVE: replaces the database contents and the uploaded files.
#   ./ops/restore.sh /var/backups/enrolla/20261005-010000 --yes
# Stop the API, workers and website first (sudo systemctl stop enrolla-*). Restore into a spare database first if unsure:
#   TARGET_DATABASE_URL=postgresql://user@localhost/enrolla_test ./ops/restore.sh <backup> --yes
set -euo pipefail

SRC="${1:?usage: restore.sh <backup-folder> --yes}"
[ "${2:-}" = "--yes" ] || { echo "Refusing to run without --yes (this overwrites data)." >&2; exit 1; }
ENV_FILE="${ENV_FILE:-/etc/enrolla/backend.env}"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
TARGET="${TARGET_DATABASE_URL:-${DATABASE_URL:?DATABASE_URL is not set}}"
FILES_DIR="${RESTORE_FILES_DIR:-${LOCAL_STORAGE_DIR:-}}"

( cd "$SRC" && sha256sum --check --quiet SHA256SUMS ) || { echo "Checksum mismatch: this backup is damaged." >&2; exit 1; }
pg_restore --clean --if-exists --no-owner --dbname "${TARGET%%\?*}" "$SRC/db.dump"
if [ -f "$SRC/files.tar.gz" ] && [ -n "$FILES_DIR" ]; then mkdir -p "$FILES_DIR"; tar -C "$FILES_DIR" -xzf "$SRC/files.tar.gz"; fi
echo "Restore complete from $SRC. Start the services again."
