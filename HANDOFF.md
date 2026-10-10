# HANDOFF - read this first (for the next AI assistant or developer)

Enrolla = admissions platform (schools, colleges, universities) for Malawi, now growing a **School Hub** (see `docs/school-hub.md`).
Branch: `claude/amazing-allen-v8q4e9` (never push elsewhere; no PRs unless asked). Owner runs dev on **macOS 11 (Big Sur)**,
production is **Ubuntu 22.04** on their own server (no cloud account, no card, no forex). Owner talks in short messages: keep answers plain,
say what was NOT verified, and keep going autonomously.

## Repo map
```
backend/    Express + Prisma 6 + Postgres. src/routes/*, src/lib/*, src/jobs/{worker,wa-worker}.ts, src/realtime.ts, prisma/migrations
web/        Next 15 (app router, client components, BFF cookie auth, nonce CSP). src/app/app/<role>/..., src/components, src/lib
mobile/     Expo 57 + expo-router app for PARENTS/STUDENTS (offline cache + write queue). src/*, app/*
shared/i18n en/ny(Chichewa)/tum(Tumbuka) JSON = single source; `node shared/i18n/sync.mjs` validates + copies to web/mobile
e2e/        Playwright: e2e.mjs (web), mobile.mjs (mobile web build); run.sh / mobile-run.sh boot everything
sms-forwarder/ Android app that forwards Airtel/Mpamba payment SMS (not built/tested on a device)
docs/       whatsapp, realtime, phone-verification, decision-letters, application-form, deploy-t620, school-hub
ops/        systemd units, nginx, backup scripts, env templates
```

## Run (dev)
```bash
cd backend && cp .env.example .env && npm i && npm run dev:all   # API + WhatsApp worker; runs prisma generate + migrate deploy first
npx tsx --env-file=.env scripts/dev-seed.ts                      # demo data. Password for all: Passw0rd-demo1
cd web && npm i && npm run dev          # http://localhost:3000
cd mobile && npm i && npx expo start    # API address found automatically; or mobile/.env EXPO_PUBLIC_API_URL
```
Demo logins: owner@enrolla.test (TOTP secret JBSWY3DPEHPK3PXP), school@enrolla.test (secret GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ), student@enrolla.test.
Verification codes: in development with no WhatsApp/SMS configured the code is shown on screen (never in production).
WhatsApp (whatsapp-web.js) on macOS 11 needs Chrome 138: see `docs/whatsapp.md`, `npm run wa:check`.

## Verify before every commit (all must pass; say so honestly in the reply)
```bash
cd backend && npx tsc --noEmit -p . && npx tsx --test test/*.test.ts
NODE_ENV=test INTEGRATION=1 npx tsx --test --test-concurrency=1 test/integration/*.test.ts   # needs Postgres (DATABASE_URL, JWT_* secrets)
cd web && npx tsc --noEmit ; cd mobile && npx tsc --noEmit && npm test
bash e2e/run.sh ; bash e2e/mobile-run.sh      # need Chromium (CHROME_PATH), built web (`next build`) / mobile web export
node shared/i18n/sync.mjs                      # i18n keys identical in 3 languages, same {placeholders}
```
Sandbox notes (Claude Code web session): Postgres runs from a scratch dir on port 5544 (`pgup.sh`), proxy blocks WhatsApp/most hosts,
Chromium at /opt/pw-browsers. Run e2e as a background-safe command; leaked servers on ports 3000/4000/8081 break the next run (kill by port).
**Never `pkill -f <pattern>` in a tool command (it kills your own shell); start long processes with `setsid` and kill the group.**

## Conventions and gotchas (learned the hard way)
- Money = integer minor units (tambala). Fees: `splitFee` (institution commission 30% + student service fee 30%).
- **Prisma queries only run when awaited / `.then` / `.catch` is attached** (a bare `void prisma.x.updateMany()` does nothing).
- Prisma: after pulling schema changes the owner MUST run `npx prisma generate && npx prisma migrate deploy` (`npm run dev` now does it).
  Migrations are hand-written SQL in `backend/prisma/migrations/<timestamp>_name/` (non-interactive `migrate dev` fails for required columns). Edit schema.prisma carefully (a past python edit landed inside a `@default("{}")` and broke two models).
- Auth: JWT 15 min + rotating refresh (web: httpOnly cookie via Next BFF; mobile: SecureStore). MFA (TOTP) required for owner and for institution sensitive actions (`requireMfa`). Phone verification gate `requireVerifiedPhone` (OTP via platform WhatsApp, SMS fallback Africa's Talking).
- Access checks live in `src/lib/access.ts` (`canActForStudent`) and per-route `inst(req)` scoping. **Every school row is scoped by institutionId.** Add new checks there, not ad hoc.
- Notifications: `notifyUsers()` (lib/notify.ts) = DB row + live WebSocket push (`publish`, Postgres NOTIFY). Clients translate by `type` (`notif.<TYPE>` i18n keys) - add the key in all 3 languages.
- WhatsApp: per-institution session (`WaOutbox.sessionKey` = institution id, folder `WA_DATA_DIR/session-<id>`), platform session `platform`. Insert a `WaOutbox` row to send; the wa-worker process delivers.
- Decisions on applications can be HELD (`decisionPublishedAt`): use `maskHeld()` for anything an applicant can read; announce via `publishDecision()`.
- i18n: edit `shared/i18n/*.json` (python script that adds keys + `sort` is the pattern used), run `sync.mjs`. Chichewa/Tumbuka strings are best-effort and need a native speaker's review (`docs/i18n.md`).
- Mobile e2e/web builds: react-native-web renders testID as `data-testid`; screens stay mounted (hidden) under the stack, so use visible-only locators.
- Tests: integration tests create users directly with Prisma (set `phoneVerifiedAt`), helpers in `backend/test/integration/helpers.ts` (`submitApplication` drives the wizard incl. the payment section).

## Product state (what exists)
Admissions end to end (wizard, payments by SMS matching, decision letters send-now/hold/schedule), owner revenue sharing + settlements, per-institution WhatsApp
(QR or phone code), platform WhatsApp + SMS for verification codes, live notifications (WebSocket on the backend), mobile app for parents/students (offline queue),
3 languages. **Not built / unverified**: SMS forwarder on a real phone, real WhatsApp pairing/delivery, push to closed apps (needs FCM/APNs, deliberately skipped),
virus scanning of uploads, refunds, undo of a decision, multiple staff per institution (needed by School Hub teachers), load test for 70k users, independent security test, CI.

## School Hub - build status
Decisions and data model: `docs/school-hub.md`. **Phase 1 is built, tested (backend, 8 integration tests in `school.int.test.ts`) and type-checked; the new web/mobile screens have NOT been exercised in a browser or on a phone** (no e2e yet) - do that first.

Built:
- [x] Schema + migration `20261011100000_school_hub` (Role TEACHER, SchoolClass, Subject, Enrolment, Guardianship, TeachingAssignment, Assessment, Grade, Attendance, Announcement(+Read), RosterImport).
- [x] Backend `/v1/school/*` (`routes/school.ts`: staff, classes, subjects, assignments, roster preview/commit/rollback, students, guardianship block, attendance, assessments/grades incl. CSV + publish, announcements) and `/v1/me/school/*` (`routes/schoolFamily.ts`). Logic in `lib/roster.ts`, `lib/schoolAccess.ts`, `lib/grading.ts`, `lib/csv.ts`.
- [x] i18n keys `sh.*`, `nav.*`, `notif.ATTENDANCE_*|RESULTS_PUBLISHED|ANNOUNCEMENT`, `err.*` in en/ny/tum (ny/tum are my drafts: need native review). Notifications render with `notifText()` (web `lib/i18n.tsx`, mobile `src/i18n.tsx`) using `n.data` as variables.
- [x] Web: `/app/school` (classes), `/roster`, `/staff`, `/attendance`, `/results`, `/announcements` (admin + teacher; TEACHER role wired into nav/layout/homeFor) and `/app/family/school` (child switcher, progress with feedback, attendance, notices).
- [x] Mobile: parent/student "School" tab (`mobile/app/(tabs)/school.tsx`).

Remaining, in priority order:
1. Smoke test it for real: `npm run dev:all`, import `roster/template.csv`, add a teacher, mark attendance, publish a result, read as parent (extend `e2e/e2e.mjs`; mobile `e2e/mobile-run.sh`).
2. Teacher sign-in UX: teachers are added by phone and must use "Forgot password" once. Add an explicit invite link/SMS text and a first-login hint. Teacher mobile screens (attendance + grades) - web only for now.
3. Phase 2: teacher<->guardian threads (one per child per teacher, ALL guardians of the child see the same thread; `Guardianship.canMessage`), class channels (teacher+students), homework submissions, quiet-hours setting (default OFF; urgent notices ignore it), claim code/QR and first-login "is this your child?" confirmation, staff invite UI polish, WhatsApp copy for urgent notices already works via `WaOutbox`.
4. Phase 3: paid tutoring subscription for parents (monthly, schools pay nothing; manual 30-day mobile-money payment matched by the SMS reader like admissions payments), teacher data bundles (check Africa's Talking airtime support for Malawi), fees tracking, report-card PDFs, primary grading scales (percentage only today), xlsx import.
5. Still open from before: native-speaker review of Chichewa/Tumbuka, real-phone tests (SMS forwarder, WhatsApp, native date picker), 70k-user load test, independent security test, CI, Malawi data-protection review for children's records.

Upload fix (latest): signed upload/download links for the local storage driver now use the origin the client called (`rememberOrigin` in `lib/storage.ts`), not `PUBLIC_API_URL` - phones/LAN devices could not reach `localhost` links. PUT also checks magic bytes. If uploads still fail behind nginx, raise `client_max_body_size` (default 1 MB).

Gotchas: after pulling, run `npx prisma generate && npx prisma migrate deploy` in `backend/` (stale client gives "Unknown argument"). In a fresh sandbox start Postgres (`pg_ctlcluster 16 main start`), create role/db, and export `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` before `npm run test:int`.
