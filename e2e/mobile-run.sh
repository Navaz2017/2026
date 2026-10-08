#!/bin/bash
# Mobile app e2e: boots the API against a DISPOSABLE dev database and drives the app's web build in Chromium.
#   (cd ../mobile && EXPO_PUBLIC_API_URL=http://localhost:4000 npx expo export --platform web --output-dir dist-web)
#   CHROME_PATH=/path/to/chromium bash mobile-run.sh
set -u
cd "$(dirname "$0")"
ROOT=$(cd .. && pwd)
export DATABASE_URL=${E2E_DATABASE_URL:-postgresql://app:app@localhost:5432/enrolla_e2e}
export NODE_ENV=development PORT=4000 CORS_ORIGINS=http://localhost:8081 PUBLIC_API_URL=http://localhost:4000 WEB_URL=http://localhost:3000
export JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET:-e2e-access-secret-0123456789abcdef0123} JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET:-e2e-refresh-secret-0123456789abcdef012}
export LOCAL_STORAGE_DIR=$(mktemp -d)
[ -d node_modules ] || npm i --no-audit --no-fund >/dev/null
cd "$ROOT/backend"
npx prisma migrate deploy >/dev/null && npx tsx scripts/dev-seed.ts >/dev/null
psql "$DATABASE_URL" -q -f "$ROOT/e2e/reset.sql" 2>/dev/null
npx tsx src/server.ts >/tmp/e2e-api.log 2>&1 & API=$!
for i in $(seq 1 40); do curl -sf localhost:4000/healthz >/dev/null && break; sleep 1; done
SHOTS="$ROOT/e2e/shots" node "$ROOT/e2e/mobile.mjs"; RC=$?
kill $API 2>/dev/null
exit $RC
