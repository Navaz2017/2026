# Enrolla — schools, colleges & universities admissions platform

> Name chosen: **Enrolla**. Still to do: check the domain, trademark (MW + target markets) and App Store / Play Store availability.

One app, four mailboxes: **schools/colleges/universities, parents, students and the system owner** all sign in to the same
Next.js web app / Expo mobile app. Like Gmail, the UI shell is shared and the **role in the token** decides what data and
actions you get — enforced on the server, never just hidden in the UI.

```
backend/   Node + Express + Prisma/Postgres + Redis/BullMQ   (REST /v1, role-scoped)
web/       Next.js shell with role-based navigation + owner revenue/dashboard pages
e2e/        Real-browser (Playwright) end-to-end test of the web app
shared/i18n/  Chichewa / Tumbuka / English strings (single source) + checker
docs/       i18n.md (translation review!), whatsapp.md
sms-forwarder/  Native Android app that forwards Airtel/Mpamba payment SMS (see its README)
mobile/    Expo app for parents & students (iOS + Android) — offline cache + write queue, OTP sign-up, full application wizard, payment
docker-compose.yml   Postgres + Redis for local dev
```

Run locally: `docker compose up -d`, then in `backend/`: copy `.env.example` → `.env`, `npm i`, `npx prisma migrate dev`, `npm run dev`
(and `npx tsx src/jobs/worker.ts` for letters). Then `OWNER_EMAIL=… OWNER_PASSWORD=… npx tsx scripts/create-owner.ts` creates the owner and the default 30%/30% revenue config.

## Name options considered
1. **Enrolla** – "enrol" + "all"; short, friendly, easy to say.
2. **Kwathu Admissions** ("Kwathu" = "our place/home" in Chichewa) – warm, local identity.
3. **ApplyMW** – plain and searchable; says exactly what it does.
4. **Sukulu Hub** – "sukulu" (school) + hub for every institution.
5. **OpenGate** – the gateway to every school, college and university.
6. **Admitly** – modern, app-store friendly, works beyond Malawi.
Check domain, trademark and app-store availability before choosing.

## How each requirement is met
| # | Requirement | Where |
|---|---|---|
| 1 | Institution signup + due-diligence docs → verified → live | `routes/auth.ts` signup, `institutions.ts` documents, `admin.ts` `/institutions/:id/review` (docs viewed via 60 s signed URLs, every view audited) |
| 2 | Programs before verification, activate on verification | `PENDING_VERIFICATION` → `ACTIVE` flip inside the review transaction |
| 3 | Classroom photos/videos | Presigned direct-to-S3 uploads (`institutions.ts /media`), shown publicly only for verified schools |
| 4 | Parent signup, occupation, children | `auth.ts` (PARENT requires occupation), `family.ts /children` |
| 5 | Student credentials, report required for primary/secondary, grade request to a platform school | `family.ts` applications rule + `grade-requests`; school fulfils in `institutions.ts` |
| 6–7 | Airtel Money / Mpamba cash-out + reference + phone; "you'll get confirmation" | `POST /me/applications/:id/payment` (response carries the message) |
| 8 | SMS reader app → server verifies → unique references | `routes/sms.ts` + `lib/reconcile.ts`; uniqueness = DB unique indexes `Payment(provider,reference)`, `SmsMessage(provider,reference)`, `Payment.smsId`; match needs same provider, reference, **payer phone** and amount ≥ due |
| 9 | Alert institution; decision → notify; auto letter by email/WhatsApp, institution-customised | `reconcile.ts` notifies the school; `decision` endpoint queues `jobs/worker.ts`; templates in `lib/letters.ts` |
| 10 | Revenue sharing config, month-end payouts | `RevenueConfig` (append-only, bps), fee snapshot per application, `settlements/run` (idempotent) |
| 11 | Owner dashboard | `admin.ts` + `web/src/app/app/owner` |

**Fee model (my reading of #10 — confirm):** with institution fee F, the student pays **F + 30%·F**; the institution
receives **F − 30%·F**; you keep **60% of F** (30% + 30%). Both percentages are editable; changes apply to new applications only.
All money is integer tambala (no floats); `test/core.test.ts` proves every tambala is accounted for.

## Offline-first and 70,000 users on launch day
- **Reads never hit the network from the UI**: the app reads SQLite; a sync loop pulls *deltas* (`updatedAt` cursors per collection, ≤200 rows/page).
- **Server-controlled back-off**: `nextSyncSeconds` = 15 min + random jitter (≤2 min), lengthened under load without an app release; 429/5xx → longer wait. Reconnect sync is jittered. Decisions/payment confirmations use push (FCM/APNs) so polling can stay slow.
- **Writes** go to an outbox with a UUID `clientId` (server idempotency key) → safe retries.
- 70k users ÷ 15 min ≈ **80 sync req/s average**, each a few indexed queries — modest. Launch spikes are the real risk, so:
  public catalog behind CloudFront (`Cache-Control` set), files go straight to S3, PgBouncer + read replica for `/sync/pull`,
  ≥3 stateless API containers behind a load balancer, letters/notifications in a separate BullMQ worker, load-test with k6 at 3× expected before launch.
  Add composite indexes as `EXPLAIN` demands; move rate limiting to Redis (`TODO` in `app.ts`).

## Security (honest version: no system is "unhackable" — this is defence in depth)
Implemented: argon2id passwords; 15-min JWTs + **rotating refresh tokens with reuse detection**; account lockout; Zod validation on every body;
Prisma parameterised queries; **tenant scoping on every institution/family query** (`req.user.inst`, `canActForStudent`);
helmet, strict CORS, CSP/HSTS headers on web; per-route rate limits; private S3 bucket + short-lived signed URLs + pinned type/size;
SMS endpoint authenticated by **HMAC + timestamp window + one-time nonce** over the raw body, device keys AES-GCM encrypted and revocable;
append-only audit log for owner actions; server-computed fees (client can't set prices); sanitised letter templates (no code execution).

**Must do before launch:** TOTP MFA for owners and institution admins (hook marked in `auth.ts`); move web refresh token to an httpOnly BFF cookie;
malware scanning on uploads; WAF/DDoS (Cloudflare or AWS WAF); secrets in a manager + KMS-held `DATA_ENC_KEY`; encrypted backups with restore drills;
dependency scanning (Dependabot/`npm audit`) and an independent penetration test; Malawi data-protection compliance review for children's data.

## Known gaps / decisions for you
- **SMS reader app:** built in `sms-forwarder/`. The pure logic is tested; the Android shell (receiver, WorkManager, UI) has **not been compiled or run on a device** yet — build it in Android Studio and do a real-phone test first.
- **SMS wording:** parser now covers the real Airtel (bank credit, wallet deposit) and Mpamba (money received) samples; outgoing messages are ignored. Airtel deposits carry no phone number, so Airtel is verified by unique transaction id + amount (see `sms-forwarder/README.md`). Add new wordings as you meet them (e.g. other banks, agent deposits, amounts with decimals).
- **Mobile app** (`mobile/`, see its README): built and bundled for Android + web, 6 unit tests + a 19-step Playwright run of its web build against the real API (sign-up, OTP, wizard, offline queue, payment). **Not run on a real phone or in Expo Go / iOS Simulator** — do that before release.
- **Decision letters** (`docs/decision-letters.md`): registrar sends each letter immediately, or holds them all and releases together (by hand or on a chosen date); applicants see nothing while held.
- **Live updates** (`docs/realtime.md`): self-hosted WebSocket channel on the backend (Postgres LISTEN/NOTIFY), used by web and mobile. Works while the app is open; waking a closed phone needs Google/Apple push, which is not built.
- **WhatsApp per institution** (`docs/whatsapp.md`): QR or phone-number code, checklist, test message, service heartbeat. Real pairing/delivery not testable in the sandbox.
- **Phone verification** (`docs/phone-verification.md`): codes by the platform's WhatsApp number (whatsapp-web.js) with Africa's Talking SMS fallback. Needs real WhatsApp/Africa's Talking accounts to test for real; the code paths are tested against a fake Africa's Talking server and a simulated wa-worker.
- Not yet built: malware scanning of uploads, push notifications, refunds, official WhatsApp Cloud API, PDF letterhead logos, a seeded owner-invite flow. Email uses plain SMTP (set `SMTP_*`); WhatsApp uses whatsapp-web.js (see `docs/whatsapp.md`).
- Backend typechecks; 10 unit tests and 11 end-to-end tests (real Postgres: payment↔SMS matching in both orders, single-use references, signature/replay checks, access control) pass. Initial migration is in `backend/prisma/migrations`.


## Web app (Next.js) — what exists
One shell, role-based menus (owner · institution · parent · student), in **Chichewa, Chitumbuka or English** (see `docs/i18n.md`).
- **Owner:** dashboard with alerts + 3 charts · verification queue (open documents, verify/reject/suspend) · payments & unmatched SMS (retry, manual confirm/reject with a recorded reason) · SMS phones (register, key shown once, revoke) · month-end payouts (+CSV) · revenue sharing & the numbers applicants pay to · users · activity log · two-step security.
- **Institution:** overview · applicants (search/filter) with full file, **credential viewer** (MFA-gated, audited, 60 s links) and **accept/reject** (seat-limited, letter queued) · programmes · campus gallery · letter templates with preview · grade requests · **WhatsApp linking** (QR) · earnings & payout details · verification documents.
- **Parent/student:** register children + occupation · find school/course · apply · pay (shows the Airtel/Mpamba number, reference + phone form, confirmation message) · documents upload · request grades from a previous school · download decision letter · notifications.

Account safety: change password (signs out other devices), 8 one-time **recovery codes** for a lost authenticator phone, owner can reset staff two-step security, server-side `reset-mfa` script for the owner.

Security details: refresh token only in an httpOnly SameSite=Strict cookie via a Next route handler; nonce-based CSP; MFA (TOTP) required for the owner and for institution admins' sensitive actions; password reset by email; consent captured at signup; seat counting is atomic.

### Run it
Needs Node 20+ and Docker (for Postgres + Redis).
```
git clone -b claude/amazing-allen-v8q4e9 https://github.com/Navaz2017/2026.git && cd 2026
docker compose up -d                                   # Postgres :5432, Redis :6379

cd backend && cp .env.example .env && npm install
npx prisma migrate deploy && npm run seed              # tables + demo data
npm run dev                                            # API on http://localhost:4000

# new terminal
cd web && npm install && npm run dev                   # web on http://localhost:3000
```
Demo logins (password `Passw0rd-demo1`): `owner@enrolla.test`, `school@enrolla.test` (both ask for a 6-digit code; **each has its own secret**: owner `JBSWY3DPEHPK3PXP`, school `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` — add them as two entries in your authenticator app. Real accounts always get a random secret of their own at setup), `student@enrolla.test`. Parents/students/schools can also sign up at `/signup`.
Letters and WhatsApp need the extra processes `npm run dev:worker` / `npm run dev:wa` (Redis required; WhatsApp also needs Chromium).
Tests: `cd backend && npm test && npm run test:int` · `node shared/i18n/sync.mjs` · `cd e2e && bash run.sh`.

## Running on your own server
`docs/deploy-t620.md` is a step-by-step guide for a Dell T620 (Ubuntu, local PostgreSQL, local file storage, SMTP email, nightly backups, systemd, HTTPS options) — no cloud services needed. Config templates are in `ops/`.

## Look & feel
University-style design system (see `web/src/app/globals.css`): deep navy + gold accent on white, **Source Serif 4** headings with **Source Sans 3** body (both self-hosted via `@fontsource`, so no third-party font requests and the strict CSP stays intact), a single shared header on the public site and the signed-in app, a public landing page with live programme search, split-panel sign-in, line icons instead of emoji, flat cards with hairline borders, underline tabs, WCAG-minded contrast, 44 px touch targets, skip-link, visible focus rings, dark-mode tokens. **English is the default language** and the first option in every language switcher (then Chichewa, Chitumbuka).
Public programme listings show the total the applicant will actually pay (fee + student service fee).

## Applying (multi-step)
See `docs/application-form.md`. Colleges/universities: up to 3 ranked programmes at one institution; schools: one class level (Standard 1–8, Form 1–4 MSCE, up to Form 6 Cambridge, up to the school's declared highest class). 9 steps (6 for schools), resumable draft, bio data remembered, tuition and other fees shown, public school page with photo/video gallery + the school's own preview.
