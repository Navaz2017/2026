import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { prisma } from "../../src/db.js";
import { app } from "../../src/app.js";
import { signAccess } from "../../src/middleware/auth.js";

const skip = !process.env.INTEGRATION;
let server: Server, base: string, n = 0;
before(async () => {
  if (skip) return;
  await prisma.$executeRawUnsafe(`TRUNCATE "User","Institution","WaOutbox","WhatsAppSession","Setting" RESTART IDENTITY CASCADE`);
  server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { if (!skip) { server.close(); await prisma.$disconnect(); } });
const call = (method: string, path: string, token?: string, body?: unknown) =>
  fetch(`${base}/v1${path}`, { method, headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (r: Response) => r.json() as Promise<any>;

async function school(verified = true) {
  const i = ++n;
  const inst = await prisma.institution.create({ data: { name: `School ${i}`, type: "COLLEGE", contactEmail: `s${i}@x.mw`, status: verified ? "VERIFIED" : "PENDING" } });
  const u = await prisma.user.create({ data: { email: `wa${i}@x.mw`, passwordHash: "x", phoneVerifiedAt: new Date(), role: "INSTITUTION_ADMIN", fullName: "A", institutionId: inst.id } });
  return { inst, token: signAccess({ sub: u.id, role: "INSTITUTION_ADMIN", inst: inst.id, mfa: true }), plain: signAccess({ sub: u.id, role: "INSTITUTION_ADMIN", inst: inst.id }) };
}
// Stand-in for the wa-worker (NB: Prisma queries only run when awaited or .then/.catch is attached).
const heartbeat = () => prisma.setting.upsert({ where: { key: "wa.heartbeat" }, update: { value: new Date().toISOString() }, create: { key: "wa.heartbeat", value: new Date().toISOString() } });

test("status page data: tells the admin exactly what is missing (service, verification, two-step)", { skip }, async () => {
  const s = await school(false);
  await prisma.setting.deleteMany({ where: { key: "wa.heartbeat" } });
  let st = await json(await call("GET", "/institution/whatsapp", s.plain));
  assert.deepEqual([st.workerOnline, st.institutionVerified, st.mfa, st.status], [false, false, false, "DISCONNECTED"]);
  await heartbeat();
  st = await json(await call("GET", "/institution/whatsapp", s.token));
  assert.deepEqual([st.workerOnline, st.mfa], [true, true]);
  await prisma.setting.update({ where: { key: "wa.heartbeat" }, data: { value: new Date(Date.now() - 60_000).toISOString() } });
  assert.equal((await json(await call("GET", "/institution/whatsapp", s.token))).workerOnline, false, "stale heartbeat = service down");
});

test("each institution has its own session: linking, pairing code, QR and numbers never cross over", { skip }, async () => {
  const a = await school(), b = await school();
  assert.equal((await call("POST", "/institution/whatsapp/connect", a.token, { phone: "12" })).status, 400);
  assert.equal((await call("POST", "/institution/whatsapp/connect", a.token, { phone: "0999 123 456" })).status, 202);
  assert.equal((await call("POST", "/institution/whatsapp/connect", b.token)).status, 202);
  // the worker publishes state per institution
  await prisma.whatsAppSession.update({ where: { institutionId: a.inst.id }, data: { status: "CODE", pairingCode: "ABCD-1234" } });
  await prisma.whatsAppSession.update({ where: { institutionId: b.inst.id }, data: { status: "QR", qr: "qr-payload-b" } });
  const sa = await json(await call("GET", "/institution/whatsapp", a.token)), sb = await json(await call("GET", "/institution/whatsapp", b.token));
  assert.equal(sa.pairingCode, "ABCD-1234"); assert.equal(sa.pairPhone, "+265999123456"); assert.equal(sa.qr, null);
  assert.equal(sb.qr, "qr-payload-b"); assert.equal(sb.pairingCode, null); assert.equal(sb.pairPhone, null);
  // secrets disappear once linked
  await prisma.whatsAppSession.update({ where: { institutionId: a.inst.id }, data: { status: "CONNECTED", phone: "+265999123456", pairingCode: "ABCD-1234" } });
  const linked = await json(await call("GET", "/institution/whatsapp", a.token));
  assert.equal(linked.status, "CONNECTED"); assert.equal(linked.pairingCode, null); assert.equal(linked.qr, null);
  // switching method restarts pairing with fresh state
  await call("POST", "/institution/whatsapp/connect", b.token, { phone: "0888 111 222" });
  const sw = await prisma.whatsAppSession.findUniqueOrThrow({ where: { institutionId: b.inst.id } });
  assert.deepEqual([sw.status, sw.qr, sw.pairPhone], ["STARTING", null, "+265888111222"]);
  assert.equal((await prisma.whatsAppSession.findUniqueOrThrow({ where: { institutionId: a.inst.id } })).status, "CONNECTED", "A untouched");
});

test("test message: only when linked, always through THAT institution's own session, 5 per hour", { skip }, async () => {
  const a = await school(), b = await school();
  assert.equal((await call("POST", "/institution/whatsapp/test", a.token, { phone: "0999000111" })).status, 409); // not linked yet
  await prisma.whatsAppSession.create({ data: { institutionId: a.inst.id, desired: true, status: "CONNECTED", phone: "+265999000999" } });
  assert.equal((await call("POST", "/institution/whatsapp/test", a.plain, { phone: "0999000111" })).status, 403, "needs two-step session");
  // fake worker: sends whatever is pending
  const timer = setInterval(() => void prisma.waOutbox.updateMany({ where: { status: "PENDING" }, data: { status: "SENT", sentAt: new Date() } }).catch(() => {}), 100);
  try {
    const r = await call("POST", "/institution/whatsapp/test", a.token, { phone: "0999000111" });
    assert.equal(r.status, 200);
    const row = await prisma.waOutbox.findFirstOrThrow({ where: { toPhone: "+265999000111" } });
    assert.equal(row.sessionKey, a.inst.id, "sent from A's own number, not the platform's and not B's");
    assert.match(row.text, new RegExp(a.inst.name));
    assert.equal((await call("POST", "/institution/whatsapp/test", b.token, { phone: "0999000111" })).status, 409, "B is not linked and cannot borrow A's number");
    for (let i = 0; i < 4; i++) assert.equal((await call("POST", "/institution/whatsapp/test", a.token, { phone: "0999000111" })).status, 200);
    assert.equal((await call("POST", "/institution/whatsapp/test", a.token, { phone: "0999000111" })).status, 429);
  } finally { clearInterval(timer); }
});

test("a number that is not on WhatsApp is reported, not retried forever", { skip }, async () => {
  const a = await school();
  await prisma.whatsAppSession.create({ data: { institutionId: a.inst.id, desired: true, status: "CONNECTED", phone: "+265999000999" } });
  const timer = setInterval(() => void prisma.waOutbox.updateMany({ where: { status: "PENDING" }, data: { status: "FAILED", lastError: "not_on_whatsapp" } }).catch(() => {}), 100);
  try {
    const r = await call("POST", "/institution/whatsapp/test", a.token, { phone: "0999000222" });
    assert.equal(r.status, 502); assert.equal((await json(r)).error, "not_on_whatsapp");
  } finally { clearInterval(timer); }
});
