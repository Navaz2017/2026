# Enrolla mobile app (parents & students)

Expo (React Native) app for Android and iOS. Parents and students can: sign up with a phone number and verify it by WhatsApp/SMS code,
browse schools (fees, galleries), add children, complete the multi-step application, upload documents, pay the application fee
(Airtel Money / TNM Mpamba reference), follow decisions and download letters. English, Chichewa and Tumbuka (whole app switches).
Schools and the platform owner use the website; they see a "use the website" screen here.

## Offline behaviour (designed for patchy connections)
- Everything you have viewed (school lists, school pages, applications, notifications) is kept on the phone and shown when offline.
- Answers in the application wizard are saved on the phone when there is no connection (banner: "N changes waiting to be sent") and
  are sent in order when the connection returns. Re-opening the wizard shows what you typed.
- **Needs a connection** (the server must answer): creating the application, choosing programmes (fee is calculated by the server),
  uploading documents, submitting, and paying. The app says so instead of pretending.
- Signing out wipes the saved data and tokens from the phone. Tokens live in the OS keychain/keystore.

## Run it
```bash
cd mobile
npm install
npx expo start
```
Scan the QR with **Expo Go** (Android) or the Camera app (iOS). The phone and the computer must be on the same Wi-Fi.
**No API address to type:** in development the app uses the computer that runs `expo start` (port 4000) automatically.
If the API is elsewhere, put it in `mobile/.env` (copy `.env.example`; Expo reads it by itself, restart after editing):
`EXPO_PUBLIC_API_URL=http://192.168.1.20:4000`. Release builds must set it to your **https** address.
The API's `CORS_ORIGINS` only matters for the browser build (`npx expo start --web`).
Verification codes: with no WhatsApp/SMS configured on the server (development) the code is shown on the screen.

## Build installable apps (free account is enough to start)
```bash
npm i -g eas-cli && eas login
# put EXPO_PUBLIC_API_URL=https://api.example.org in mobile/.env first (or in eas.json env)
eas build -p android --profile preview   # APK to share
eas build -p ios --profile preview                                                   # needs an Apple developer account (paid)
```
Change the bundle id / package (`mw.enrolla.app`) in `app.json` to your own before publishing. Set `EXPO_PUBLIC_API_URL` to your **HTTPS** address for release builds.

## Checks that exist
- `npm run typecheck` · `npm test` (offline-queue logic, 6 tests)
- `npm run export:web` / `npm run export:android` (bundles the app; proves it compiles)
- `e2e/mobile.mjs` drives the **web build** of this app in Chromium against the real API (sign-up, OTP, wizard, offline queue sent after reconnect,
  uploads, payment, sign-out wipe): `bash e2e/mobile-run.sh`.

**Not verified:** running on a real Android/iOS device or Expo Go (keychain, native file picker, keyboard behaviour, layouts on small phones),
push notifications (not built), video playback inside the app (videos open in the phone's player).
