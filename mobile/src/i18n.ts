import { useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";
import en from "./i18n/en.json";
import ny from "./i18n/ny.json";
import tum from "./i18n/tum.json";

// Same JSON as the web app (shared/i18n -> `node shared/i18n/sync.mjs`). Works fully offline: the strings ship in the bundle.
export type Lang = "en" | "ny" | "tum";
const DICTS: Record<Lang, Record<string, string>> = { en, ny, tum };
let current: Lang = "en";
const listeners = new Set<() => void>();

export async function loadLang() {
  const saved = await SecureStore.getItemAsync("lang");
  if (saved === "en" || saved === "ny" || saved === "tum") { current = saved; listeners.forEach((l) => l()); }
}
export async function setLang(l: Lang) { current = l; await SecureStore.setItemAsync("lang", l); listeners.forEach((f) => f()); } // also PATCH /v1/auth/me when online

export function t(key: string, vars?: Record<string, string | number>) {
  const s = DICTS[current][key] ?? DICTS.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? "")) : s;
}
// Re-renders every screen when the language changes, so the WHOLE app switches at once.
export const useLang = () => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => current);
