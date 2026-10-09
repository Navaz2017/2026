# WhatsApp linking (whatsapp-web.js)

> Two kinds of WhatsApp numbers use the same wa-worker: **each institution's own number** (decision letters, below) and
> **the platform's number** (sign-up codes; the owner links it in *Owner → Messaging*, see `phone-verification.md`).
> Work reaches the worker through the `WaOutbox` database table (no Redis involved); the old BullMQ `wa-send` queue is gone.

Each verified institution links **its own WhatsApp number** from *Dashboard → WhatsApp* (two-step security required). The page opens
with a checklist (WhatsApp service running? institution verified? two-step security on?) so it is obvious what is missing, then offers
two ways to link: **scan a QR code**, or **type the school's number and enter an 8-character code** on that phone
(*WhatsApp → Linked devices → Link a device → Link with phone number instead*). Once linked, **Send test** proves it works.
Numbers are never shared: letters from institution A leave only through A's session (`WaOutbox.sessionKey` = institution id).
1. Click **Link WhatsApp** (or *Get code*) → the API records `desired=true` (and the phone, for code pairing).
2. The separate **wa-worker** process (`npm run wa-worker`) sees that, starts a headless Chromium with a persistent
   `LocalAuth` session for that institution, and publishes the pairing QR into the DB (`WhatsAppSession`).
3. The dashboard shows the QR or the 8-character code (refreshing every 3 s). Switching method restarts the pairing.
   The worker writes a heartbeat every 5 s; if it is older than 20 s the page says "the WhatsApp service is not running".
   Typical failures are shown in plain words (server cannot reach WhatsApp; Chrome/Chromium not installed).
4. Status becomes **Linked** with the number. Sessions survive restarts (no re-scan). **Unlink** logs the device out and deletes the session.
5. Decision letters: the letter job generates the PDF, always emails it, and — if the institution is linked and the
   applicant has a phone — queues a WhatsApp message + PDF (paced 1.5–4 s apart, max 20/min) via the wa-worker.

## You must know
- **whatsapp-web.js is unofficial.** It automates WhatsApp Web, which can breach WhatsApp's Terms of Service; numbers can be
  banned, and WhatsApp can break it with any update. The dashboard warns institutions. Email + in-app notices always remain.
  The sender sits behind one table (`WaOutbox`), so moving to the official **WhatsApp Business Cloud API** later means
  replacing `jobs/wa-worker.ts` only. For a product handling children's admissions, plan that migration.
- **Resources:** one headless Chromium per linked institution (~300–500 MB RAM each). `WA_MAX_SESSIONS` (default 40)
  caps it. Run **exactly one** wa-worker process (sessions live on its disk, `WA_DATA_DIR`; use a persistent volume).
  Set `PUPPETEER_EXECUTABLE_PATH` to a system Chromium in containers.
- **Security:** the QR is only returned to that institution's authenticated admin while status is `QR`; connect/disconnect
  are MFA-gated and audited. Session folders contain WhatsApp credentials — encrypt the volume and restrict access.
- **Tested here:** API ↔ worker lifecycle (request → Chromium launched → state written back, including failure).
  **Not tested:** a real QR scan and message delivery (the sandbox cannot reach WhatsApp). Do a real-phone test first.
