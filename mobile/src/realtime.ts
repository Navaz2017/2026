import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { getAccessToken, refresh } from "./api";
import { API } from "./config";
import { onReconnect } from "./net";

// Live updates over a WebSocket to OUR OWN API (/v1/realtime) - the self-hosted counterpart of Firebase's real-time channel.
// Works while the app is open (or recently in the background). It cannot wake a phone whose app is closed: that needs
// Google/Apple push, which this project deliberately does not depend on. Anything missed is caught up on reconnect.
const WS_URL = API.replace(/^http/, "ws") + "/v1/realtime";

interface State { unread: number; connected: boolean; toast: { id: string; type: string } | null; version: number }
let state: State = { unread: 0, connected: false, toast: null, version: 0 };
const subs = new Set<() => void>();
export const setLive = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const useStore = <T,>(sel: (s: State) => T) => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => sel(state), () => sel(state));
export const useUnread = () => useStore((s) => s.unread);
export const useLiveVersion = () => useStore((s) => s.version); // bumps on every live event: lists reload themselves
export const useLiveConnected = () => useStore((s) => s.connected);

let stopFn: (() => void) | undefined;
export function startRealtime() {
  stopFn?.();
  let ws: WebSocket | undefined, stopped = false, tries = 0, timer: ReturnType<typeof setTimeout> | undefined, renew: ReturnType<typeof setInterval> | undefined;
  const auth = () => JSON.stringify({ type: "auth", token: getAccessToken() });

  const connect = async () => {
    if (stopped || (ws && ws.readyState <= WebSocket.OPEN)) return;
    if (!getAccessToken()) await refresh();
    if (stopped) return;
    const sock = new WebSocket(WS_URL); ws = sock;
    sock.onopen = () => sock.send(auth());
    sock.onmessage = (ev) => {
      let m: any; try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.type === "ready") { tries = 0; setLive({ connected: true, unread: m.unread ?? 0, version: state.version + 1 }); } // version bump = catch up on anything missed
      else if (m.type === "notification") setLive({ unread: state.unread + 1, toast: { id: m.notification?.id ?? String(Date.now()), type: m.notification?.type ?? "" }, version: state.version + 1 });
      else if (m.type === "read") setLive({ unread: 0 });
    };
    sock.onclose = async (ev) => {
      if (renew) clearInterval(renew);
      setLive({ connected: false });
      if (stopped) return;
      if (ev.code === 4001 || ev.code === 4401) await refresh();
      timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** tries++) + Math.random() * 1000);
    };
    sock.onerror = () => {};
    renew = setInterval(async () => { if (sock.readyState === WebSocket.OPEN && (await refresh()) === "ok") sock.send(auth()); }, 10 * 60_000); // access tokens last 15 min
  };
  void connect();
  const sub = AppState.addEventListener("change", (s) => { if (s === "active") { if (timer) clearTimeout(timer); void connect(); } }); // back to the app: reconnect right away
  const off = onReconnect(() => { if (timer) clearTimeout(timer); void connect(); });
  stopFn = () => { stopped = true; if (timer) clearTimeout(timer); if (renew) clearInterval(renew); sub.remove(); off(); ws?.close(); setLive({ connected: false, unread: 0, toast: null }); };
  return stopFn;
}
export const stopRealtime = () => { stopFn?.(); stopFn = undefined; };

