# Live updates (self-hosted "Firebase")

Firebase's real-time features are a WebSocket channel plus a push service. This project runs the first part itself, on the same backend:

```
 browser / phone ──WebSocket──► API  /v1/realtime  ◄── LISTEN enrolla_events ──┐
                                                                                │  Postgres NOTIFY
 API routes · letters worker · SMS matcher ── notifyUsers() ── INSERT + pg_notify ┘
```
- **Protocol:** open `wss://api/v1/realtime`, send `{"type":"auth","token":"<access token>"}` within 5 s (the token is never put in the URL).
  Server replies `{"type":"ready","unread":N}`, then pushes `{"type":"notification","notification":{…}}` and `{"type":"read"}`.
  Send `auth` again with a fresh token before the 15-minute token expires (the clients do this every 10 min); otherwise the server closes with 4001.
- **Why Postgres NOTIFY:** any process that creates a notification (API, worker, SMS reconciliation) just inserts and notifies; every API process LISTENs
  and forwards to its own sockets. Several API processes work without Redis or any extra service.
- **Safety:** access-token verification (HS256, issuer checked), browser `Origin` must be in `CORS_ORIGINS`, 5 sockets per user (oldest dropped),
  30 per IP, 4 KB message limit, 25 s ping/pong with dead-socket cleanup, a user never receives another user's events. Nothing sensitive is in the
  event: the type and ids; screens fetch details over the normal authenticated API.
- **Catch-up:** every (re)connect re-sends the unread count and the clients reload their lists, so nothing is missed while offline.
- **Web:** header dot (green = live), pop-up toast, bell badge, and the notifications / applications / dashboard pages refresh themselves.
  The old 60-second polling now only runs while the socket is down.
- **Mobile:** banner + Notifications tab badge + automatic refresh of lists, while the app is open.
- **Behind nginx:** the `/v1/realtime` block in `ops/nginx/enrolla.conf` (Upgrade headers, long read timeout). Cloudflare Tunnel supports WebSockets as is.

## The limit you should know about
This delivers instantly **while the app/page is open** (and for a short while after a phone app goes to the background). It **cannot wake a closed
phone app** - on Android and iOS that needs Google's/Apple's push service (FCM/APNs); there is no way around that. Until then, important events also reach people
by WhatsApp/SMS/email (decision letters, verification codes). If you later want true background push, FCM is free but is a Google service
and needs a Firebase project; the `publish()` hook in `backend/src/realtime.ts` is where it would plug in.

Scale: a socket costs a few KB; 70,000 people online at once is well within one modest server, but raise `ulimit -n` / systemd `LimitNOFILE` (e.g. 100000).

## Tests
`backend/test/integration/realtime.int.test.ts` (auth, isolation between users, multi-device, forged/expired tokens, origin check, renewal,
connection caps, oversize frames) and the browser tests in `e2e/` (student's open page updates when the school accepts; phone banner when the owner confirms a payment).
