import NetInfo from "@react-native-community/netinfo";
import { db } from "./db";
import { getAccessToken } from "./auth";

const API = process.env.EXPO_PUBLIC_API_URL!;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

async function call(method: string, path: string, body?: unknown) {
  return fetch(`${API}/v1${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await getAccessToken()}` }, body: body ? JSON.stringify(body) : undefined });
}

// 1) Push queued writes (idempotent, so retries after a dropped connection are safe).
async function flushOutbox() {
  const rows = db.getAllSync<{ clientId: string; method: string; path: string; body: string; attempts: number }>("SELECT * FROM outbox ORDER BY createdAt LIMIT 25");
  for (const r of rows) {
    const res = await call(r.method, r.path, { ...JSON.parse(r.body), clientId: r.clientId });
    if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) db.runSync("DELETE FROM outbox WHERE clientId = ?", r.clientId); // 4xx = permanently rejected; surface in UI
    else if (res.status >= 500 || res.status === 429) { db.runSync("UPDATE outbox SET attempts = attempts + 1 WHERE clientId = ?", r.clientId); break; }
  }
}

// 2) Pull deltas per collection. Returns server-suggested delay.
async function pull(): Promise<number> {
  let next = 900;
  for (let page = 0; page < 20; page++) {
    const cursors = db.getAllSync<{ coll: string; since: string }>("SELECT * FROM cursors");
    const qs = cursors.map((c) => `c.${c.coll}=${encodeURIComponent(c.since)}`).join("&");
    const res = await call("GET", `/sync/pull?${qs}`);
    if (!res.ok) return res.status === 429 ? 1800 : 900;
    const { data, hasMore, nextSyncSeconds } = await res.json();
    db.withTransactionSync(() => {
      for (const [coll, rows] of Object.entries<any[]>(data)) {
        for (const r of rows) db.runSync("INSERT OR REPLACE INTO docs (coll,id,json,updatedAt) VALUES (?,?,?,?)", coll, r.id, JSON.stringify(r), r.updatedAt);
        const last = rows[rows.length - 1];
        if (last) db.runSync("INSERT OR REPLACE INTO cursors (coll, since) VALUES (?,?)", coll, last.updatedAt);
      }
    });
    next = nextSyncSeconds;
    if (!hasMore) break;
  }
  return next;
}

export async function syncNow() {
  if (running || !(await NetInfo.fetch()).isConnected) return;
  running = true;
  try { await flushOutbox(); return await pull(); } finally { running = false; }
}

// Foreground loop: the server tells us how long to wait (with jitter), so it can shed load centrally.
// Also register expo-background-fetch to call syncNow() when the app is closed, and expo-notifications
// (FCM/APNs) so decisions and payment confirmations arrive instantly without polling.
export function startSyncLoop() {
  const tick = async () => {
    const wait = (await syncNow().catch(() => undefined)) ?? 900;
    timer = setTimeout(tick, wait * 1000);
  };
  tick();
  NetInfo.addEventListener((s) => s.isConnected && setTimeout(syncNow, Math.random() * 5000)); // jittered reconnect
  return () => timer && clearTimeout(timer);
}
