// Self-hosted real-time channel (the job Firebase does, running on this server):
//   * browsers/phones hold one WebSocket to  /v1/realtime  (authenticated with the normal access token)
//   * anything that creates a notification - the API, the letters worker, the SMS matcher - calls publish(), which
//     does a Postgres NOTIFY; every API process LISTENs and forwards the event to that user's open sockets.
// So it works across several API processes, needs no Redis and no third-party service.
// Limits: delivers only while the app/page is open. Waking a closed phone needs Google/Apple push; that is not built.
import type { Server } from "node:http";
import type { IncomingMessage } from "node:http";
import jwt from "jsonwebtoken";
import pg from "pg";
import { WebSocket, WebSocketServer } from "ws";
import { config } from "./config.js";
import { prisma } from "./db.js";

const CHANNEL = "enrolla_events";
const PATH = "/v1/realtime";
const MAX_PER_USER = 5, MAX_PER_IP = 30, AUTH_DEADLINE_MS = 5000, PING_MS = 25_000;

export interface LiveEvent { type: string; [k: string]: unknown }

// Called from any process. Never throws: a missed live event is harmless, clients also catch up from the database on reconnect.
export async function publish(userIds: string[], event: LiveEvent) {
  try {
    for (const userId of userIds) {
      const payload = JSON.stringify({ u: userId, e: event });
      if (payload.length < 7500) await prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${payload})`;
    }
  } catch (e) { console.warn("realtime publish failed:", (e as Error).message); }
}

interface Conn { ws: WebSocket; ip: string; userId?: string; expTimer?: ReturnType<typeof setTimeout>; alive: boolean }

export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const byUser = new Map<string, Set<Conn>>();
  const perIp = new Map<string, number>();
  const origins = config.CORS_ORIGINS.split(",");
  let closed = false;

  const drop = (c: Conn) => {
    if (c.userId) { const s = byUser.get(c.userId); s?.delete(c); if (s && !s.size) byUser.delete(c.userId); }
    if (c.expTimer) clearTimeout(c.expTimer);
  };
  const send = (c: Conn, m: unknown) => { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m)); };

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    if (new URL(req.url ?? "/", "http://x").pathname !== PATH) return; // other upgrade handlers (none) / ignore
    const origin = req.headers.origin; // browsers send it; native apps do not
    const ip = (config.NODE_ENV === "production" ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() : "") || req.socket.remoteAddress || "?";
    if ((origin && !origins.includes(origin)) || (perIp.get(ip) ?? 0) >= MAX_PER_IP) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); return void socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const c: Conn = { ws, ip, alive: true };
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
      const deadline = setTimeout(() => { if (!c.userId) ws.close(4401, "auth_timeout"); }, AUTH_DEADLINE_MS);
      ws.on("pong", () => { c.alive = true; });
      ws.on("message", async (raw) => {
        let m: any; try { m = JSON.parse(raw.toString()); } catch { return ws.close(4400, "bad_message"); }
        if (m?.type !== "auth" || typeof m.token !== "string") return;
        try {
          const p = jwt.verify(m.token, config.JWT_ACCESS_SECRET, { algorithms: ["HS256"], issuer: "admissions" }) as { sub: string; exp: number };
          if (c.userId && c.userId !== p.sub) return ws.close(4403, "user_mismatch");
          const first = !c.userId;
          c.userId = p.sub;
          if (c.expTimer) clearTimeout(c.expTimer);
          c.expTimer = setTimeout(() => ws.close(4001, "token_expired"), Math.max(1000, p.exp * 1000 - Date.now())); // client renews before this
          if (first) {
            clearTimeout(deadline);
            const set = byUser.get(p.sub) ?? new Set<Conn>(); byUser.set(p.sub, set); set.add(c);
            if (set.size > MAX_PER_USER) { const oldest = set.values().next().value as Conn; oldest.ws.close(4000, "too_many_connections"); drop(oldest); }
            send(c, { type: "ready", unread: await prisma.notification.count({ where: { userId: p.sub, readAt: null } }) });
          } else send(c, { type: "renewed" });
        } catch { ws.close(4401, "invalid_token"); }
      });
      ws.on("close", () => { clearTimeout(deadline); drop(c); const n = (perIp.get(ip) ?? 1) - 1; if (n > 0) perIp.set(ip, n); else perIp.delete(ip); });
      ws.on("error", () => {});
    });
  });

  const ping = setInterval(() => {
    for (const set of byUser.values()) for (const c of set) { if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; c.ws.ping(); }
  }, PING_MS);

  // One dedicated connection per process listens for events published by any process.
  let listener: pg.Client | undefined, retry: ReturnType<typeof setTimeout> | undefined;
  async function listen(delay = 500) {
    if (closed) return;
    const client = new pg.Client({ connectionString: config.DATABASE_URL });
    client.on("notification", (msg) => {
      try { const { u, e } = JSON.parse(msg.payload ?? ""); byUser.get(u)?.forEach((c) => send(c, e)); } catch { /* ignore malformed */ }
    });
    const again = () => { if (!closed) { client.removeAllListeners(); client.end().catch(() => {}); retry = setTimeout(() => void listen(Math.min(delay * 2, 15_000)), delay); } };
    client.on("error", again); client.on("end", again);
    try { await client.connect(); await client.query(`LISTEN ${CHANNEL}`); listener = client; } catch { again(); }
  }
  void listen();

  return {
    connections: () => [...byUser.values()].reduce((n, s) => n + s.size, 0),
    close: async () => {
      closed = true; clearInterval(ping); if (retry) clearTimeout(retry);
      for (const set of byUser.values()) for (const c of set) c.ws.terminate();
      wss.close();
      await listener?.end().catch(() => {});
    },
  };
}
