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
# where is the API?  emulator: http://10.0.2.2:4000   phone on same Wi-Fi: http://<your server's LAN IP>:4000
EXPO_PUBLIC_API_URL=http://192.168.1.20:4000 npx expo start
```
Scan the QR with **Expo Go** (Android) or the Camera app (iOS). The API's `CORS_ORIGINS` is only needed for the browser build.
Verification codes: with no WhatsApp/SMS configured on the server (development) the code is shown on the screen.

## Build installable apps (free account is enough to start)
```bash
npm i -g eas-cli && eas login
EXPO_PUBLIC_API_URL=https://api.example.org eas build -p android --profile preview   # APK to share
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
