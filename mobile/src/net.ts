import NetInfo from "@react-native-community/netinfo";
import { useSyncExternalStore } from "react";
import { API } from "./config";

// Is the internet reachable? Ask OUR server (not a third party): this app only ever needs our API, and it works on a LAN too.
NetInfo.configure({ reachabilityUrl: `${API}/healthz`, reachabilityMethod: "GET", reachabilityTest: async (r) => r.status === 200, reachabilityShortTimeout: 4000, reachabilityLongTimeout: 15000, reachabilityRequestTimeout: 8000 });

let online = true, version = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const hooks = new Set<() => void>();
export const onReconnect = (f: () => void) => { hooks.add(f); return () => { hooks.delete(f); }; };

async function ping() {
  try { const c = new AbortController(); const t = setTimeout(() => c.abort(), 4000); const r = await fetch(`${API}/healthz`, { signal: c.signal }); clearTimeout(t); return r.ok; } catch { return false; }
}

// While offline, knock on our server every few seconds: the OS can be slow to tell us the connection is back.
let probe: ReturnType<typeof setInterval> | undefined;
function set(now: boolean) {
  if (now === online) return;
  online = now;
  if (now) { version++; if (probe) clearInterval(probe); probe = undefined; emit(); setTimeout(() => hooks.forEach((f) => f()), Math.random() * 1500); } // small random delay: thousands of phones must not reconnect in the same instant
  else { emit(); probe ??= setInterval(async () => { if (await ping()) set(true); }, 6000); }
}
NetInfo.addEventListener((s) => { const now = s.isConnected !== false && s.isInternetReachable !== false; if (now) set(true); else void confirmOffline(); });
// A reply from our server proves we are online. One failed request proves nothing (the server may just have hiccupped),
// so before going "offline" we check with a tiny request to /healthz.
let checking = false;
async function confirmOffline() { if (checking || !online) return; checking = true; try { if (!(await ping())) set(false); } finally { checking = false; } }
export const markOnline = () => set(true);
export const markOffline = () => { void confirmOffline(); };

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useOnline = () => useSyncExternalStore(subscribe, () => online, () => true);
// Bumps only when the connection COMES BACK, so screens reload their stale data once.
export const useNetVersion = () => useSyncExternalStore(subscribe, () => version, () => 0);
export const isOnline = () => online;
