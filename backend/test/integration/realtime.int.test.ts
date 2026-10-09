import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import WebSocket from "ws";
import jwt from "jsonwebtoken";
import { prisma } from "../../src/db.js";
import { app } from "../../src/app.js";
import { attachRealtime } from "../../src/realtime.js";
import { signAccess } from "../../src/middleware/auth.js";
import { notifyUsers } from "../../src/lib/notify.js";
import { config } from "../../src/config.js";

const skip = !process.env.INTEGRATION;
let server: Server, base: string, wsUrl: string, live: ReturnType<typeof attachRealtime>, n = 0;
before(async () => {
  if (skip) return;
  await prisma.$executeRawUnsafe(`TRUNCATE "User","Institution","Notification","RevenueConfig" RESTART IDENTITY CASCADE`);
  server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`; wsUrl = `ws://127.0.0.1:${port}/v1/realtime`;
  live = attachRealtime(server);
  await new Promise((r) => setTimeout(r, 400)); // LISTEN connection
});
after(async () => { if (!skip) { await live.close(); server.close(); await prisma.$disconnect(); } });

const user = async () => { const i = ++n; const u = await prisma.user.create({ data: { email: `rt${i}@x.mw`, passwordHash: "x", phoneVerifiedAt: new Date(), role: "STUDENT", fullName: "S" } }); return { id: u.id, token: signAccess({ sub: u.id, role: "STUDENT" }) }; };

// A client that records every message and close code.
function client(origin?: string) {
  const ws = new WebSocket(wsUrl, origin ? { origin } : undefined);
  const msgs: any[] = []; let closed: number | undefined;
  ws.on("message", (d) => msgs.push(JSON.parse(d.toString())));
  ws.on("close", (code) => { closed = code; });
  ws.on("error", () => {});
  const open = new Promise<void>((res, rej) => { ws.on("open", () => res()); ws.on("error", rej); });
  const waitFor = async (f: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
  return { ws, msgs, open, waitFor, closed: () => closed };
}

test("authenticated socket gets a ready message with the unread count, then live notifications", { skip }, async () => {
  const u = await user();
  await notifyUsers([u.id], "PAYMENT_CONFIRMED", "", ""); // one already waiting
  const c = client(); await c.open;
  c.ws.send(JSON.stringify({ type: "auth", token: u.token }));
  assert.ok(await c.waitFor(() => c.msgs.some((m) => m.type === "ready")));
  assert.equal(c.msgs.find((m) => m.type === "ready").unread, 1);
  await notifyUsers([u.id], "APPLICATION_ACCEPTED", "", "", { applicationId: "a1" });
  assert.ok(await c.waitFor(() => c.msgs.some((m) => m.type === "notification")), "live delivery");
  const m = c.msgs.find((x) => x.type === "notification");
  assert.equal(m.notification.type, "APPLICATION_ACCEPTED"); assert.deepEqual(m.notification.data, { applicationId: "a1" }); assert.ok(m.notification.id);
  c.ws.close();
});

test("a user only ever receives their own events; all of a user's devices receive them", { skip }, async () => {
  const a = await user(), b = await user();
  const a1 = client(), a2 = client(), b1 = client();
  await Promise.all([a1.open, a2.open, b1.open]);
  a1.ws.send(JSON.stringify({ type: "auth", token: a.token })); a2.ws.send(JSON.stringify({ type: "auth", token: a.token })); b1.ws.send(JSON.stringify({ type: "auth", token: b.token }));
  await Promise.all([a1, a2, b1].map((c) => c.waitFor(() => c.msgs.some((m) => m.type === "ready"))));
  await notifyUsers([a.id], "PAYMENT_CONFIRMED", "", "");
  assert.ok(await a1.waitFor(() => a1.msgs.some((m) => m.type === "notification")) && await a2.waitFor(() => a2.msgs.some((m) => m.type === "notification")));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(b1.msgs.filter((m) => m.type === "notification").length, 0, "other user must not see it");
  // marking read on one device clears the badge on the other
  const r = await fetch(`${base}/v1/auth/notifications/read`, { method: "POST", headers: { Authorization: `Bearer ${a.token}` } });
  assert.equal(r.status, 204);
  assert.ok(await a2.waitFor(() => a2.msgs.some((m) => m.type === "read")));
  [a1, a2, b1].forEach((c) => c.ws.close());
});

test("bad or missing credentials are closed; nothing is delivered unauthenticated", { skip }, async () => {
  const u = await user();
  const bad = client(); await bad.open; bad.ws.send(JSON.stringify({ type: "auth", token: "nope" }));
  assert.ok(await bad.waitFor(() => bad.closed() === 4401));
  const forged = client(); await forged.open; forged.ws.send(JSON.stringify({ type: "auth", token: jwt.sign({ sub: u.id, role: "STUDENT" }, "x".repeat(40), { algorithm: "HS256", issuer: "admissions" }) }));
  assert.ok(await forged.waitFor(() => forged.closed() === 4401), "token signed with another secret");
  const silent = client(); await silent.open;
  await notifyUsers([u.id], "PAYMENT_CONFIRMED", "", "");
  assert.ok(await silent.waitFor(() => silent.closed() === 4401, 7000), "no auth within 5 s -> closed");
  assert.equal(silent.msgs.length, 0);
});

test("foreign browser origins are refused; native apps (no Origin) are fine", { skip }, async () => {
  const evil = client("https://evil.example"); await assert.rejects(evil.open);
  const ok = client(config.CORS_ORIGINS.split(",")[0]); await ok.open; ok.ws.close();
});

test("an expired token ends the session unless the client renews it; renewal keeps the same socket", { skip }, async () => {
  const u = await user();
  const short = jwt.sign({ sub: u.id, role: "STUDENT" }, config.JWT_ACCESS_SECRET, { algorithm: "HS256", issuer: "admissions", expiresIn: 2 });
  const c = client(); await c.open;
  c.ws.send(JSON.stringify({ type: "auth", token: short }));
  await c.waitFor(() => c.msgs.some((m) => m.type === "ready"));
  c.ws.send(JSON.stringify({ type: "auth", token: u.token })); // renew with a fresh 15-minute token
  assert.ok(await c.waitFor(() => c.msgs.some((m) => m.type === "renewed")));
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(c.closed(), undefined, "renewed, so still open");
  const other = await user(); // cannot swap to another user's token on the same socket
  c.ws.send(JSON.stringify({ type: "auth", token: other.token }));
  assert.ok(await c.waitFor(() => c.closed() === 4403));
  const short2 = jwt.sign({ sub: u.id, role: "STUDENT" }, config.JWT_ACCESS_SECRET, { algorithm: "HS256", issuer: "admissions", expiresIn: 2 });
  const c2 = client(); await c2.open; c2.ws.send(JSON.stringify({ type: "auth", token: short2 }));
  await c2.waitFor(() => c2.msgs.some((m) => m.type === "ready"));
  assert.ok(await c2.waitFor(() => c2.closed() === 4001, 4000), "unrenewed token expires");
});

test("sixth device of one user replaces the oldest; oversize messages are rejected", { skip }, async () => {
  const u = await user();
  const cs: ReturnType<typeof client>[] = [];
  for (let i = 0; i < 6; i++) { const c = client(); await c.open; c.ws.send(JSON.stringify({ type: "auth", token: u.token })); await c.waitFor(() => c.msgs.some((m) => m.type === "ready")); cs.push(c); }
  assert.ok(await cs[0]!.waitFor(() => cs[0]!.closed() === 4000), "oldest dropped");
  assert.equal(cs[5]!.closed(), undefined);
  cs[5]!.ws.send("x".repeat(10_000));
  assert.ok(await cs[5]!.waitFor(() => cs[5]!.closed() !== undefined), "oversize frame closes the socket");
  cs.forEach((c) => c.ws.close());
});
