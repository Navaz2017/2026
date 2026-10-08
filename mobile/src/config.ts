// Address of the Enrolla API. Set EXPO_PUBLIC_API_URL when you run/build (see mobile/README.md):
//   Android emulator -> http://10.0.2.2:4000   |   phone on the same Wi-Fi -> http://<server LAN IP>:4000
//   production       -> https://your-domain
export const API = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
