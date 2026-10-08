# Phone verification (sign-up and password reset)

Everyone who signs up gives a **phone number**; email is optional for parents and students (required for schools).
A 6-digit code proves the number before anything that creates records about a child or moves money.

## How a code is delivered
1. **WhatsApp** — from the platform's own number, through whatsapp-web.js (the same `wa-worker` process used for school letters).
   The API inserts a row in `WaOutbox` and waits up to ~10 s for the worker to mark it sent.
2. **SMS** — if WhatsApp is not linked, the number is not on WhatsApp, or the worker is slow/down, the code goes out by
   **Africa's Talking**. The unsent WhatsApp row is cancelled first so nobody gets two codes.
3. **Development only** (`NODE_ENV` ≠ production) with neither configured: the code is printed in the API log and returned as
   `devCode` so you can try the screens. **In production the code is never returned**; if no channel works the API answers
   `503 otp_undeliverable`.

Messages are sent in the user's language (English / Chichewa / Tumbuka). The Tumbuka and Chichewa wording needs a native-speaker check
(see `docs/i18n.md`).

## One-time setup
**Africa's Talking** (create an account at africastalking.com; their sandbox is free):
```
AT_USERNAME=sandbox            # your app username ("sandbox" while testing)
AT_API_KEY=...                 # Settings → API key
AT_SENDER_ID=Enrolla           # optional, must be approved for Malawi networks; leave empty to use their shortcode
AT_ENV=sandbox                 # or production
```
In the **sandbox** messages only reach the simulator in their dashboard, not real phones. Switch to production when you have
credit. Check pricing for Airtel/TNM Malawi before launch; paying them needs a way to top up from Malawi — confirm this works for you.

**Platform WhatsApp number**: start `npm run wa-worker`, sign in as the owner (two-step security required), open **Messaging**,
press **Link WhatsApp**, scan the QR from *WhatsApp → Linked devices* on a **dedicated** phone/number. Use **Send test** to check.
Remember whatsapp-web.js is unofficial (see `whatsapp.md`): a ban is possible, which is exactly why SMS is the fallback.

## Rules enforced by the API
- Code lifetime 10 minutes; max 5 wrong guesses per code; a new code replaces older ones.
- Resend: at least 45 s apart, at most 5 codes per number per hour.
- Codes are stored only as an HMAC; never logged in production.
- Until the phone is verified: signed in users can reach only the verification screen. The API refuses creating an application draft,
  submitting, paying, uploading a credential (`403 phone_not_verified`) and a school's verification-document upload.
- Wrong number? The user may correct it (re-sends a code) until it is verified.
- Sign in with **email or phone** (`identifier`). Forgot password: a phone number gets a code (`/auth/reset-phone`), an email gets a link.
- Signing up with a phone/email that already exists returns the same generic answer (no account enumeration). Caveat: someone can
  register another person's phone number *unverified* and block it until it is verified or the account is removed — consider a
  clean-up job for unverified accounts older than a few days.

## Tests
`backend/test/integration/otp.int.test.ts` runs against a **fake Africa's Talking server** and a **simulated wa-worker**
(WhatsApp path, failure fallback, silent worker fallback, cooldown, hourly cap, 5-guess lock, reset by phone).
