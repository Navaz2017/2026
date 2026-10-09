import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, authCall, clearTokens, get, hasRefreshToken, logoutRemote, patch, refresh, setOnSignedOut } from "./api";
import { useT, type Lang } from "./i18n";
import { kv } from "./kv";
import { clearOfflineData, flushOutbox } from "./offline";
import { startRealtime, stopRealtime } from "./realtime";

export type Role = "SYSTEM_OWNER" | "INSTITUTION_ADMIN" | "PARENT" | "STUDENT";
export interface User { id: string; email: string | null; phone: string | null; phoneVerified: boolean; fullName: string; role: Role; language: Lang; institutionId: string | null }
interface Ctx {
  user: User | null; loading: boolean;
  signIn: (path: "login" | "signup", body: unknown) => Promise<any>;
  signOut: () => Promise<void>; reload: () => Promise<void>; changeLanguage: (l: Lang) => void;
}
const Session = createContext<Ctx>(null as never);
export const useSession = () => useContext(Session);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null), [loading, setLoading] = useState(true);
  const { setLang, lang, ready } = useT();

  const load = useCallback(async () => {
    try {
      const u = await get<User>("/auth/me");
      await kv.set("me", u); setUser(u);
    } catch (e) {
      // No connection: keep working from the last known profile (the data screens read their own caches).
      if (e instanceof ApiError && e.status === 0) setUser(await kv.get<User>("me")); else setUser(null);
    }
  }, []);

  const wipe = useCallback(async () => { await clearTokens(); await kv.del("me"); await clearOfflineData(); setUser(null); }, []);
  useEffect(() => { setOnSignedOut(() => { void wipe(); }); }, [wipe]);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      if (await hasRefreshToken()) { const r = await refresh(); if (r !== "denied") await load(); }
      setLoading(false);
    })();
  }, [ready, load]);

  useEffect(() => { if (user) void flushOutbox().catch(() => {}); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // live channel for verified family accounts; stops on sign-out
  useEffect(() => { if (user?.phoneVerified && (user.role === "PARENT" || user.role === "STUDENT")) { startRealtime(); return () => stopRealtime(); } }, [user?.id, user?.phoneVerified]); // eslint-disable-line react-hooks/exhaustive-deps

  const signIn: Ctx["signIn"] = async (path, body) => {
    const d = await authCall(path, body);
    await load();
    return d;
  };
  const signOut = async () => { await logoutRemote(); await wipe(); };
  const changeLanguage = (l: Lang) => { setLang(l); if (user) { setUser({ ...user, language: l }); patch("/auth/me", { language: l }).catch(() => {}); } };
  void lang;
  return <Session.Provider value={{ user, loading, signIn, signOut, reload: load, changeLanguage }}>{children}</Session.Provider>;
}

export const isFamily = (r?: Role) => r === "PARENT" || r === "STUDENT";
