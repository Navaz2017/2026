import Constants from "expo-constants";
import { Platform } from "react-native";

// Where is the Enrolla API?  In order:
//  1. EXPO_PUBLIC_API_URL (from mobile/.env, or the command line) - always wins; REQUIRED for release builds (use your https address)
//  2. development: the same computer that is serving the app (`expo start`) on port 4000 - found automatically, so a phone on the same
//     Wi-Fi reaches the API without any setting. (Expo Go on an Android emulator also works: it reports 10.0.2.2.)
//  3. the browser build: the host the page was loaded from
//  4. http://localhost:4000
const DEV_API_PORT = process.env.EXPO_PUBLIC_API_PORT ?? "4000";

function guess(): string {
  const hostUri = (Constants.expoConfig as { hostUri?: string } | null)?.hostUri ?? (Constants as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost;
  const host = hostUri?.split(":")[0];
  if (host && Platform.OS !== "web") return `http://${host}:${DEV_API_PORT}`;
  if (Platform.OS === "web" && typeof location !== "undefined") return `http://${location.hostname}:${DEV_API_PORT}`;
  return `http://localhost:${DEV_API_PORT}`;
}

export const API = (process.env.EXPO_PUBLIC_API_URL || guess()).replace(/\/$/, "");
