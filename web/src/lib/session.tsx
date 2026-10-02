"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getAccessToken, refreshSession, setAccessToken, patch, type Role } from "./api";
import { useT, type Lang } from "./i18n";

export interface User { id: string; email: string; fullName: string; role: Role; language: Lang; mfaEnabled: boolean; mfa: boolean; institutionId: string | null }
interface Ctx { user: User | null; loading: boolean; reload: () => Promise<void>; signIn: (path: "login" | "signup" | "mfa-enable", body: unknown) => Promise<void>; signOut: () => Promise<void>; changeLanguage: (l: Lang) => void }
const Session = createContext<Ctx>(null as never);
export const useSession = () => useContext(Session);

export const homeFor = (r: Role) => ({ SYSTEM_OWNER: "/app/owner", INSTITUTION_ADMIN: "/app/institution", PARENT: "/app/family", STUDENT: "/app/family" })[r];

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { setLang } = useT();

  const reload = useCallback(async () => {
    try {
      const u = await api<User>("/auth/me");
      // A language picked on this device (e.g. on the login page) wins and is saved to the account;
      // on a fresh device the account's saved language is used.
      let local: string | null = null;
      try { local = localStorage.getItem("lang"); } catch {}
      if ((local === "en" || local === "ny" || local === "tum") && local !== u.language) {
        patch("/auth/me", { language: local }).catch(() => {});
        setUser({ ...u, language: local });
      } else { setUser(u); setLang(u.language); }
    } catch { setUser(null); }
  }, [setLang]);

  useEffect(() => { // restore the session from the httpOnly cookie on first load
    (async () => { if (await refreshSession()) await reload(); setLoading(false); })();
  }, [reload]);

  const signIn: Ctx["signIn"] = async (path, body) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(path === "mfa-enable" && { Authorization: `Bearer ${getAccessToken()}` }) };
    const r = await fetch(`/api/auth/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error ?? "internal"), { code: data.error ?? "internal", status: r.status });
    setAccessToken(data.accessToken);
    await reload();
  };

  const signOut = async () => { await fetch("/api/auth/logout", { method: "POST" }); setAccessToken(null); setUser(null); window.location.href = "/login"; };
  const changeLanguage = (l: Lang) => { setLang(l); if (user) { setUser({ ...user, language: l }); patch("/auth/me", { language: l }).catch(() => {}); } };

  return <Session.Provider value={{ user, loading, reload, signIn, signOut, changeLanguage }}>{children}</Session.Provider>;
}
