import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Plain key/value for caches and the outbox. Every call is guarded: storage can be unavailable (private mode, full disk)
// and the app must still run - it just won't be offline-capable.
export const kv = {
  async get<T>(key: string): Promise<T | null> { try { const s = await AsyncStorage.getItem(key); return s ? (JSON.parse(s) as T) : null; } catch { return null; } },
  async set(key: string, value: unknown) { try { await AsyncStorage.setItem(key, JSON.stringify(value)); } catch {} },
  async del(key: string) { try { await AsyncStorage.removeItem(key); } catch {} },
  async keys(prefix: string): Promise<string[]> { try { return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix)); } catch { return []; } },
};

// Tokens: OS keychain / keystore on phones. (The browser build, used only for development and tests, has no keychain and uses localStorage.)
export const secret = {
  async get(key: string): Promise<string | null> { try { return Platform.OS === "web" ? localStorage.getItem(key) : await SecureStore.getItemAsync(key); } catch { return null; } },
  async set(key: string, v: string) { try { if (Platform.OS === "web") localStorage.setItem(key, v); else await SecureStore.setItemAsync(key, v); } catch {} },
  async del(key: string) { try { if (Platform.OS === "web") localStorage.removeItem(key); else await SecureStore.deleteItemAsync(key); } catch {} },
};
