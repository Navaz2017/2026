# Enrolla SMS Forwarder (Android)

A tiny native Android app that lives on a **dedicated phone** holding the Airtel Money / TNM Mpamba number(s) that
receive application fees. It forwards **only incoming-payment SMS** to the Enrolla server, which verifies them
against what applicants typed in (`backend/src/lib/reconcile.ts`).

Why native Kotlin and not Expo: React Native/Expo can't reliably receive SMS in the background. This app is
~400 lines, no UI framework, easy to audit. It is **sideloaded** (Google Play does not allow SMS-reading apps of this kind).

## How it behaves
- `SmsReceiver` catches each SMS, stitches multi-part messages, and keeps it **only if** `MoneyFilter` says it is an
  incoming-money message (Airtel "You have received MK…" / "has deposited MK…", Mpamba "Money Received from…").
  Chats, OTPs and "sent" receipts never leave the phone.
- The message is written to a local SQLite queue **before** any network call, then uploaded by WorkManager
  (needs network, exponential back-off). Offline phone = nothing lost.
- Every 15 min `BackfillWorker` rescans the inbox (last 7 days on first run) so a missed broadcast, reboot or
  battery-saver kill can't lose a payment. Duplicates are harmless: local `UNIQUE` index + server unique indexes.
- Each request is signed `HMAC-SHA256(key, "<timestampMs>.<nonce>.<sha256(body)>")`; server rejects wrong
  signature, clocks > 5 min off, and reused nonces. The key is stored in Android Keystore-backed encrypted prefs.
  HTTPS only (cleartext disabled).

## Setup (≈5 minutes per phone)
1. In the owner dashboard / API: `POST /v1/admin/devices {"label":"Airtel phone 1"}` → returns `id` and `key` **once**.
2. Build: open `sms-forwarder/` in Android Studio → Build > Generate Signed Bundle/APK (use your own keystore), or `gradle :app:assembleRelease`.
3. Install the APK on the phone. If Android blocks the SMS permission for a sideloaded app: *Settings → Apps → Enrolla SMS Forwarder → ⋮ → Allow restricted settings*, then allow SMS.
4. In the app: enter server URL (`https://…`), device id, key → **Save → Allow SMS access → battery exemption → Test connection**.
5. Keep the phone powered, on Wi-Fi/data, with **automatic date & time** on. Revoke a lost phone with `DELETE /v1/admin/devices/:id`.

## Matching rules (what your sample messages revealed)
- **Mpamba** SMS include the sender's phone → must equal the phone the applicant typed (any format: 088…, +26588…, 26588…).
- **Airtel** deposit SMS show only a *name* (or bank), not a number → phone can't be checked; the unique transaction id
  (`TID CI260915.1803.125840`, or `BW….` / the bank `Ref` on bank credits — either is accepted) + amount ≥ due is the proof,
  and the id is single-use. The payer name is stored for the owner to eyeball in disputes.
- References are case/space/trailing-dot insensitive.

## Tests
- `gradle :core:test` — signature is byte-compatible with the Node backend (shared test vector, incl. non-ASCII key), filter accepts your 3 incoming formats and rejects outgoing/chat/OTP.
- Backend: `npm test` (parser on all 8 real samples) and `npm run test:int` (full flow on Postgres).
- No phone yet? `backend/scripts/sms-simulator.ts` sends a signed SMS exactly like the app.
