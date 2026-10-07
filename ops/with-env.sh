#!/usr/bin/env bash
# Run any command with the server's settings loaded:   ./ops/with-env.sh npx prisma migrate deploy
set -euo pipefail
set -a; . "${ENV_FILE:-/etc/enrolla/backend.env}"; set +a
exec "$@"
