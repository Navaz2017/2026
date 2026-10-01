# Enrolla — schools, colleges & universities admissions platform

> Name chosen: **Enrolla**. Still to do: check the domain, trademark (MW + target markets) and App Store / Play Store availability.

One app, four mailboxes: **schools/colleges/universities, parents, students and the system owner** all sign in to the same
Next.js web app / Expo mobile app. Like Gmail, the UI shell is shared and the **role in the token** decides what data and
actions you get — enforced on the server, never just hidden in the UI.

```
backend/   Node + Express + Prisma/Postgres + Redis/BullMQ   (REST /v1, role-scoped)
web/       Next.js shell with role-based navigation + owner revenue/dashboard pages
sms-forwarder/  Native Android app that forwards Airtel/Mpamba payment SMS (see its README)
mobile/    Expo (iOS + Android, build with EAS) — SQLite local-first store, outbox, delta sync
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
- Not yet built: owner UI pages for devices / unmatched SMS, PDF letter rendering, email/WhatsApp provider wiring (stubs in `jobs/worker.ts`), web pages beyond owner dashboard/revenue, mobile screens, DB migrations (run `prisma migrate dev`), malware scan, MFA, malware/virus pipeline, seat counting on acceptance.
- Backend typechecks; 10 unit tests and 11 end-to-end tests (real Postgres: payment↔SMS matching in both orders, single-use references, signature/replay checks, access control) pass. Initial migration is in `backend/prisma/migrations`.
