"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getAccessToken, refreshSession } from "./api";
import { useT } from "./i18n";
import { useSession } from "./session";

// Live updates over a WebSocket to OUR OWN API (/v1/realtime): the self-hosted equivalent of Firebase's real-time channel.
// One socket per open tab. Reconnects by itself (with back-off) and, on every (re)connect, the server tells us the unread count
// so nothing is missed while we were offline.
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const WS_URL = API.replace(/^http/, "ws") + "/v1/realtime";

export interface LiveEvent { type: string; [k: string]: any }
interface Toast { id: string; type: string }
interface Ctx { unread: number; setUnread: (n: number) => void; connected: boolean; subscribe: (f: (e: LiveEvent) => void) => () => void }
const Realtime = createContext<Ctx>({ unread: 0, setUnread: () => {}, connected: false, subscribe: () => () => {} });
export const useRealtime = () => useContext(Realtime);

// Re-run a page's loader when something relevant happens (e.g. a payment confirmed, a new application arrived).
export function useLiveReload(reload: () => void, types: string[] = ["notification", "ready"]) {
  const { subscribe } = useRealtime();
  const ref = useRef(reload); ref.current = reload;
  useEffect(() => subscribe((e) => { if (types.includes(e.type)) ref.current(); }), [subscribe]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const { t } = useT();
  const [unread, setUnread] = useState(0), [connected, setConnected] = useState(false), [toasts, setToasts] = useState<Toast[]>([]);
  const subs = useRef(new Set<(e: LiveEvent) => void>());
  const subscribe = useCallback((f: (e: LiveEvent) => void) => { subs.current.add(f); return () => { subs.current.delete(f); }; }, []);

  useEffect(() => {
    if (!user) return;
    let ws: WebSocket | undefined, stopped = false, tries = 0, timer: ReturnType<typeof setTimeout> | undefined, renew: ReturnType<typeof setInterval> | undefined;
    const authMsg = () => JSON.stringify({ type: "auth", token: getAccessToken() });

    const connect = async () => {
      if (stopped) return;
      if (!getAccessToken()) await refreshSession();
      ws = new WebSocket(WS_URL);
      ws.onopen = () => ws!.send(authMsg());
      ws.onmessage = (ev) => {
        let m: LiveEvent; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === "ready") { tries = 0; setConnected(true); setUnread(m.unread ?? 0); }
        else if (m.type === "notification") {
          setUnread((n) => n + 1);
          const id = m.notification?.id ?? String(Date.now());
          setToasts((x) => [...x.slice(-2), { id, type: m.notification?.type ?? "" }]);
          setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 8000);
        } else if (m.type === "read") setUnread(0);
        subs.current.forEach((f) => f(m));
      };
      ws.onclose = async (ev) => {
        setConnected(false); if (renew) clearInterval(renew);
        if (stopped) return;
        if (ev.code === 4001 || ev.code === 4401) await refreshSession(); // token ran out: get a fresh one first
        const delay = Math.min(30_000, 1000 * 2 ** tries++) + Math.random() * 1000;
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => {};
      // access tokens last 15 minutes: swap in a fresh one on the open socket every 10
      renew = setInterval(async () => { if (ws?.readyState === WebSocket.OPEN && (await refreshSession())) ws.send(authMsg()); }, 10 * 60_000);
    };
    void connect();
    return () => { stopped = true; if (timer) clearTimeout(timer); if (renew) clearInterval(renew); ws?.close(); setConnected(false); };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const text = (type: string) => (t(`notif.${type}`) === `notif.${type}` ? type : t(`notif.${type}`));
  return (
    <Realtime.Provider value={{ unread, setUnread, connected, subscribe }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => <div key={x.id} className="toast"><span>{text(x.type)}</span> <Link href="/app/notifications">{t("rt.view")}</Link></div>)}
      </div>
    </Realtime.Provider>
  );
}
