"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import en from "../i18n/en.json";
import ny from "../i18n/ny.json";
import tum from "../i18n/tum.json";

export type Lang = "en" | "ny" | "tum";
export const LANGS: Lang[] = ["en", "ny", "tum"];
const DICTS: Record<Lang, Record<string, string>> = { en, ny, tum };

type Vars = Record<string, string | number>;
interface Ctx { lang: Lang; setLang: (l: Lang) => void; t: (key: string, vars?: Vars) => string }
const I18n = createContext<Ctx>({ lang: "en", setLang: () => {}, t: (k) => k });

// Falls back to English, then to the key itself, so a missing translation never breaks a page.
export function translate(lang: Lang, key: string, vars?: Vars) {
  const s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? "")) : s;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    try { const l = localStorage.getItem("lang"); if (l === "en" || l === "ny" || l === "tum") setLangState(l); } catch {}
  }, []);
  useEffect(() => { document.documentElement.lang = lang === "tum" ? "tum" : lang; }, [lang]);
  const setLang = useCallback((l: Lang) => { setLangState(l); try { localStorage.setItem("lang", l); } catch {} }, []);
  const value = useMemo(() => ({ lang, setLang, t: (k: string, v?: Vars) => translate(lang, k, v) }), [lang, setLang]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export const useT = () => useContext(I18n);

// Each language is shown in its own name so someone who cannot read English can still find theirs.
export function LanguageSwitcher({ onChange }: { onChange?: (l: Lang) => void }) {
  const { lang, setLang, t } = useT();
  return (
    <div className="langs" role="group" aria-label={t("common.language")}>
      {LANGS.map((l) => (
        <button key={l} className={l === lang ? "lang on" : "lang"} aria-pressed={l === lang} onClick={() => { setLang(l); onChange?.(l); }}>
          {t(`lang.${l}`)}
        </button>
      ))}
    </div>
  );
}
