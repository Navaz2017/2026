#!/bin/bash
# Real-browser end-to-end test: boots the API + built web app against a DISPOSABLE dev database, seeds demo data,
# and drives Chromium through language switching, parent signup, owner MFA login + all owner screens,
# institution review/accept, and the student view.
#   docker compose up -d db            # Postgres on :5432
#   (cd ../web && npm run build)      # production build
#   CHROME_PATH=/path/to/chromium bash run.sh     # CHROME_PATH optional if Playwright browsers are installed
set -u
cd "$(dirname "$0")"
ROOT=$(cd .. && pwd)
export DATABASE_URL=${E2E_DATABASE_URL:-postgresql://app:app@localhost:5432/enrolla_e2e}
export NODE_ENV=development PORT=4000 CORS_ORIGINS=http://localhost:3000 PUBLIC_API_URL=http://localhost:4000 WEB_URL=http://localhost:3000
export JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET:-e2e-access-secret-0123456789abcdef0123} JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET:-e2e-refresh-secret-0123456789abcdef012}
export LOCAL_STORAGE_DIR=$(mktemp -d)
[ -d node_modules ] || npm i --no-audit --no-fund >/dev/null
cd "$ROOT/backend"
npx prisma migrate deploy >/dev/null && npx tsx scripts/dev-seed.ts >/dev/null
psql "$DATABASE_URL" -q -f "$ROOT/e2e/reset.sql" 2>/dev/null
npx tsx src/server.ts >/tmp/e2e-api.log 2>&1 & API=$!
# WhatsApp service (needs Chromium: set CHROME_PATH). Without internet the test expects a readable "cannot reach WhatsApp" message.
WAW=; if [ -n "${CHROME_PATH:-}" ]; then WA_DATA_DIR=$(mktemp -d) PUPPETEER_EXECUTABLE_PATH=$CHROME_PATH setsid npx tsx src/jobs/wa-worker.ts >/tmp/e2e-wa.log 2>&1 & WAW=$!; fi
(cd "$ROOT/web" && exec npx next start -p 3000 >/tmp/e2e-web.log 2>&1) & WEB=$!
for i in $(seq 1 40); do curl -sf localhost:4000/healthz >/dev/null && curl -sf -o /dev/null localhost:3000/ && break; sleep 1; done
SHOTS="$ROOT/e2e/shots" node "$ROOT/e2e/e2e.mjs"; RC=$?
kill $API $WEB 2>/dev/null; [ -n "$WAW" ] && { kill -- -$WAW 2>/dev/null; }  # setsid made it a process group: stops npx, tsx, node and Chrome
exit $RC
