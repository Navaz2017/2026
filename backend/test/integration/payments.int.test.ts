// Needs Postgres: INTEGRATION=1 DATABASE_URL=... npm run test:int   (DB must be disposable — it is wiped)
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { prisma } from "../../src/db.js";
import { app } from "../../src/app.js";
import { signAccess } from "../../src/middleware/auth.js";
import { deviceSignature, encrypt } from "../../src/lib/crypto.js";

const skip = !process.env.INTEGRATION;
let server: Server, base: string, device: { id: string; key: string };
let counter = 0;

before(async () => {
  if (skip) return;
  await prisma.$executeRawUnsafe(`TRUNCATE "User","Institution","Device","RevenueConfig" RESTART IDENTITY CASCADE`);
  server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const key = crypto.randomBytes(32).toString("hex");
  device = { id: (await prisma.device.create({ data: { label: "t", keyEnc: encrypt(key) } })).id, key };
  await prisma.revenueConfig.create({ data: { institutionCommissionBps: 3000, studentServiceFeeBps: 3000, createdById: "x" } });
});
after(async () => { if (!skip) { server.close(); await prisma.$disconnect(); } });

async function ingest(messages: { sender: string; body: string; receivedAt: string }[], opts: { key?: string; nonce?: string; ts?: string } = {}) {
  const raw = JSON.stringify({ messages });
  const ts = opts.ts ?? String(Date.now()), nonce = opts.nonce ?? crypto.randomBytes(16).toString("hex");
  return fetch(`${base}/v1/sms/ingest`, { method: "POST", body: raw, headers: {
    "Content-Type": "application/json", "x-device-id": device.id, "x-timestamp": ts, "x-nonce": nonce,
    "x-signature": deviceSignature(opts.key ?? device.key, ts, nonce, raw) } });
}
const sms = (body: string) => ({ sender: "AirtelMoney", body, receivedAt: new Date(Date.now() + ++counter).toISOString() });

// Fresh paid-up applicant: returns application id. Fee MK10,000 => student owes MK13,000.
async function newApplication(feeMinor = 1_000_000) {
  const n = ++counter;
  const inst = await prisma.institution.create({ data: { name: `Uni ${n}`, type: "UNIVERSITY", contactEmail: `u${n}@x.mw`, status: "VERIFIED" } });
  const prog = await prisma.program.create({ data: { institutionId: inst.id, title: "BSc", level: "UG", seats: 10, applicationFee: feeMinor, status: "ACTIVE" } });
  const user = await prisma.user.create({ data: { email: `s${n}@x.mw`, passwordHash: "x", role: "STUDENT", fullName: "S", student: { create: { fullName: "S", dateOfBirth: new Date("2005-01-01") } } }, include: { student: true } });
  const token = signAccess({ sub: user.id, role: "STUDENT" });
  const admin = await prisma.user.create({ data: { email: `a${n}@x.mw`, passwordHash: "x", role: "INSTITUTION_ADMIN", fullName: "A", institutionId: inst.id } });
  const r = await fetch(`${base}/v1/me/applications`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ studentId: user.student!.id, programId: prog.id }) });
  assert.equal(r.status, 201);
  return { ...((await r.json()) as { id: string; totalDueMinor: number; commissionMinor: number; studentServiceFeeMinor: number }), token, studentUserId: user.id, adminId: admin.id };
}
const pay = (a: { id: string; token: string }, provider: string, reference: string, payerPhone = "0999111222") =>
  fetch(`${base}/v1/me/applications/${a.id}/payment`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.token}` }, body: JSON.stringify({ provider, reference, payerPhone }) });
const status = async (id: string) => (await prisma.application.findUniqueOrThrow({ where: { id } })).status;

test("fee snapshot: student owes fee+30%, commission 30%", { skip }, async () => {
  const a = await newApplication();
  assert.deepEqual([a.totalDueMinor, a.studentServiceFeeMinor, a.commissionMinor], [1_300_000, 300_000, 300_000]);
});

test("Airtel deposit: payment first, SMS second -> confirmed, institution notified", { skip }, async () => {
  const a = await newApplication();
  const r = await pay(a, "AIRTEL_MONEY", "ci260915.1803.125840");
  assert.equal(r.status, 202);
  assert.match((await r.json()).message, /confirmation/i);
  assert.equal(await status(a.id), "PAYMENT_SUBMITTED");
  const res = await ingest([sms("SHIDAHCHITAYA has deposited MK 13,000 to your account on 15/09/26 06:03 PM.Bal: MK 9373.52. TID CI260915.1803.125840.")]);
  assert.equal((await res.json()).stored, 1);
  assert.equal(await status(a.id), "SUBMITTED");
  assert.equal(await prisma.notification.count({ where: { userId: a.adminId, type: "APPLICATION_RECEIVED" } }), 1);
  assert.equal(await prisma.notification.count({ where: { userId: a.studentUserId, type: "PAYMENT_CONFIRMED" } }), 1);
});

test("SMS first, payment second -> confirmed instantly; bank Ref alias also works", { skip }, async () => {
  const a = await newApplication();
  await ingest([sms("BW260929.1403.PL4887. You have received MK 13,000 from FCB BANK on 29/09/26 02:03 PM. Ref 000391467945 Bal: MK 10373.52.")]);
  assert.equal((await pay(a, "AIRTEL_MONEY", "000391467945")).status, 202); // applicant typed the bank Ref, not the TID
  assert.equal(await status(a.id), "SUBMITTED");
});

test("a reference can only be used once, across applicants", { skip }, async () => {
  const a = await newApplication(), b = await newApplication();
  assert.equal((await pay(a, "MPAMBA", "DHN1368TJHT")).status, 202);
  
  assert.equal((await pay(b, "MPAMBA", "dhn1368tjht")).status, 409);
});

test("one SMS cannot confirm two payments (TID and bank Ref entered by two people)", { skip }, async () => {
  const a = await newApplication(), b = await newApplication();
  assert.equal((await pay(a, "AIRTEL_MONEY", "BW260915.1030.G99287")).status, 202);
  assert.equal((await pay(b, "AIRTEL_MONEY", "FT26258JK78P")).status, 202);
  await ingest([sms("BW260915.1030.G99287. You have received MK 13,000 from NATIONAL BANK on 15/09/26 10:30 AM. Ref FT26258JK78P Bal: MK 15028.52.")]);
  const confirmed = [await status(a.id), await status(b.id)].filter((s) => s === "SUBMITTED");
  assert.equal(confirmed.length, 1);
});

test("Mpamba: declared phone must equal SMS sender phone", { skip }, async () => {
  const a = await newApplication();
  await pay(a, "MPAMBA", "DHN7777AAAA", "0888000111"); // wrong phone
  await ingest([sms("Money Received from 265883095004 JAMES BLIGHT on 23/04/2026 12:50:52. \nAmount: 13,000.00MWK \nRef: DHN7777AAAA \nBal: 2,509.28MWK")]);
  assert.equal(await status(a.id), "PAYMENT_SUBMITTED");
  const b = await newApplication();
  await pay(b, "MPAMBA", "DHN8888BBBB", "0883095004"); // correct phone, different format
  await ingest([sms("Money Received from 265883095004 JAMES BLIGHT on 23/04/2026 12:50:52. \nAmount: 13,000.00MWK \nRef: DHN8888BBBB \nBal: 2,509.28MWK")]);
  assert.equal(await status(b.id), "SUBMITTED");
});

test("underpayment is not confirmed", { skip }, async () => {
  const a = await newApplication();
  await pay(a, "AIRTEL_MONEY", "CI260914.1442.125098");
  await ingest([sms("BRIDGETMALUNGA has deposited MK 5,000 to your account on 14/09/26 02:42 PM.Bal: MK 10988.52. TID CI260914.1442.125098.")]);
  assert.equal(await status(a.id), "PAYMENT_SUBMITTED");
  assert.equal((await prisma.payment.findFirstOrThrow({ where: { applicationId: a.id } })).status, "UNDERPAID");
});

test("ingest rejects bad signature, stale timestamp, replayed nonce", { skip }, async () => {
  const m = [sms("BRIDGETMALUNGA has deposited MK 1,000 to your account on 14/09/26 02:42 PM.Bal: MK 1. TID CI260101.0000.AAAAAA.")];
  assert.equal((await ingest(m, { key: "0".repeat(64) })).status, 401);
  assert.equal((await ingest(m, { ts: String(Date.now() - 10 * 60_000) })).status, 401);
  const nonce = crypto.randomBytes(16).toString("hex");
  assert.equal((await ingest(m, { nonce })).status, 200);
  assert.equal((await ingest(m, { nonce })).status, 409);
  const bad = await fetch(`${base}/v1/sms/ingest`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  assert.equal(bad.status, 401);
});

test("same SMS uploaded twice (phone retry) is stored once", { skip }, async () => {
  const one = sms("SOMEONE has deposited MK 2,000 to your account on 14/09/26 02:42 PM.Bal: MK 1. TID CI260202.1111.BBBBBB.");
  assert.equal((await (await ingest([one])).json()).stored, 1);
  assert.equal((await (await ingest([one])).json()).stored, 0);
});

test("an applicant cannot pay for someone else's application", { skip }, async () => {
  const a = await newApplication(), b = await newApplication();
  assert.equal((await pay({ id: a.id, token: b.token }, "MPAMBA", "DHN0000ZZZZ")).status, 404);
});

test("ping verifies device settings and revoked devices are refused", { skip }, async () => {
  const send = async (id: string, key: string) => {
    const raw = "{}", ts = String(Date.now()), nonce = crypto.randomBytes(16).toString("hex");
    return fetch(`${base}/v1/sms/ping`, { method: "POST", body: raw, headers: { "Content-Type": "application/json", "x-device-id": id, "x-timestamp": ts, "x-nonce": nonce, "x-signature": deviceSignature(key, ts, nonce, raw) } });
  };
  assert.equal((await send(device.id, device.key)).status, 200);
  const key = crypto.randomBytes(32).toString("hex");
  const d = await prisma.device.create({ data: { label: "stolen", keyEnc: encrypt(key), revokedAt: new Date() } });
  assert.equal((await send(d.id, key)).status, 401);
});
