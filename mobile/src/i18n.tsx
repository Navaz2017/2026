import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import en from "./i18n/en.json";
import ny from "./i18n/ny.json";
import tum from "./i18n/tum.json";
import { kv } from "./kv";

// Same JSON as the web app (shared/i18n -> `node shared/i18n/sync.mjs`). The strings ship inside the app, so every
// screen is translated even with no internet. Choosing a language switches the WHOLE app at once.
export type Lang = "en" | "ny" | "tum";
export const LANGS: Lang[] = ["en", "ny", "tum"];
const DICTS: Record<Lang, Record<string, string>> = { en, ny, tum };
type Vars = Record<string, string | number>;

export function translate(lang: Lang, key: string, vars?: Vars) {
  const s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? "")) : s;
}

interface Ctx { lang: Lang; ready: boolean; setLang: (l: Lang) => void; t: (key: string, vars?: Vars) => string }
const I18n = createContext<Ctx>({ lang: "en", ready: false, setLang: () => {}, t: (k) => k });

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en"), [ready, setReady] = useState(false);
  useEffect(() => { kv.get<Lang>("lang").then((l) => { if (l && LANGS.includes(l)) setLangState(l); setReady(true); }); }, []);
  const setLang = useCallback((l: Lang) => { setLangState(l); kv.set("lang", l); }, []);
  const value = useMemo(() => ({ lang, ready, setLang, t: (k: string, v?: Vars) => translate(lang, k, v) }), [lang, ready, setLang]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}
export const useT = () => useContext(I18n);

// Text of a notification: announcements show the school's own title; others are translated with the event's data ({name}, {date}...).
export function notifText(t: (k: string, v?: any) => string, n: { type: string; title?: string; data?: any }) {
  if (n.type === "ANNOUNCEMENT" && n.title) return n.title;
  const key = `notif.${n.type}`, s = t(key, n.data && typeof n.data === "object" ? n.data : undefined);
  return s === key ? n.type : s;
}
