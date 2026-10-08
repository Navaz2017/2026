import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

const skip = !process.env.INTEGRATION;
// Fake Africa's Talking: records every message; can be told to reject.
const sms: { to: string; message: string; apiKey: string; from?: string }[] = [];
let smsFail = false;
const at = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c));
  req.on("end", () => {
    const f = new URLSearchParams(b);
    if (smsFail) return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 403, status: "InvalidPhoneNumber" }] } }));
    sms.push({ to: f.get("to")!, message: f.get("message")!, apiKey: String(req.headers.apikey), from: f.get("from") ?? undefined });
    res.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 101, status: "Success" }] } }));
  });
});
await new Promise<void>((r) => at.listen(0, r));
process.env.AT_BASE_URL = `http://127.0.0.1:${(at.address() as AddressInfo).port}`;
process.env.AT_USERNAME = "sandbox"; process.env.AT_API_KEY = "test-key"; process.env.AT_SENDER_ID = "Enrolla";

const { prisma } = await import("../../src/db.js");
const { app } = await import("../../src/app.js");

let server: http.Server, base: string, n = 0;
before(async () => {
  if (skip) return;
  await prisma.$executeRawUnsafe(`TRUNCATE "User","Institution","OtpCode","WaOutbox","PlatformWhatsApp","RevenueConfig" RESTART IDENTITY CASCADE`);
  server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { if (!skip) { server.close(); await prisma.$disconnect(); } at.close(); });

const call = (method: string, path: string, token?: string, body?: unknown) =>
  fetch(`${base}/v1${path}`, { method, headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (r: Response) => r.json() as Promise<any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const codeIn = (t: string) => t.match(/\b(\d{6})\b/)![1]!;
const PW = "a-long-password-1";
const signup = (phone: string, extra: object = {}) => call("POST", "/auth/signup", undefined, { password: PW, fullName: "Mayi Banda", role: "PARENT", occupation: "Farmer", consent: true, language: "ny", phone, ...extra });
const phone = () => `0999${String(100000 + ++n)}`;
const e164 = (p: string) => `+265${p.slice(1)}`;

test("signup needs a phone; email is optional for parents; code arrives by SMS in the user's language", { skip }, async () => {
  assert.equal((await call("POST", "/auth/signup", undefined, { password: PW, fullName: "No Phone", role: "STUDENT", consent: true })).status, 400);
  assert.equal((await signup("12345")).status, 400); // not a Malawian number
  sms.length = 0;
  const p = phone();
  const r = await signup(p);
  assert.equal(r.status, 201);
  const b = await json(r);
  assert.equal(b.phoneVerified, false);
  assert.equal(b.verification.channel, "sms");
  assert.equal(b.verification.devCode, undefined, "code must not be echoed when a real channel delivered it");
  assert.equal(sms.length, 1);
  assert.equal(sms[0]!.to, e164(p));
  assert.equal(sms[0]!.apiKey, "test-key");
  assert.equal(sms[0]!.from, "Enrolla");
  assert.match(sms[0]!.message, /Nambala yanu yotsimikizira/); // Chichewa
  const me = await json(await call("GET", "/auth/me", b.accessToken));
  assert.equal(me.phoneVerified, false); assert.equal(me.email, null);
});

test("unverified accounts are blocked from applying; right code verifies; wrong codes burn after 5 tries", { skip }, async () => {
  sms.length = 0;
  const p = phone();
  const b = await json(await signup(p));
  const gate = await call("POST", "/me/applications/draft", b.accessToken, {});
  assert.equal(gate.status, 403); assert.equal((await json(gate)).error, "phone_not_verified");
  const code = codeIn(sms[0]!.message), wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) assert.equal((await call("POST", "/auth/phone/verify", b.accessToken, { code: wrong })).status, 400);
  assert.equal((await call("POST", "/auth/phone/verify", b.accessToken, { code })).status, 400, "locked after 5 wrong guesses even with the right code");
  await sleep(1100);
  sms.length = 0;
  assert.equal((await call("POST", "/auth/phone/send", b.accessToken)).status, 200);
  const fresh = codeIn(sms[0]!.message);
  assert.equal((await call("POST", "/auth/phone/verify", b.accessToken, { code: fresh })).status, 200);
  assert.equal((await call("POST", "/auth/phone/verify", b.accessToken, { code: fresh })).status, 200); // idempotent once verified
  assert.notEqual((await call("POST", "/me/applications/draft", b.accessToken, {})).status, 403); // gate open (400 = body invalid)
  assert.equal((await call("POST", "/auth/phone/send", b.accessToken)).status, 409);
});

test("resend cooldown, newer code replaces older, hourly cap", { skip }, async () => {
  sms.length = 0;
  const p = phone();
  const b = await json(await signup(p));
  const first = codeIn(sms[0]!.message);
  const again = await call("POST", "/auth/phone/send", b.accessToken);
  assert.equal(again.status, 429); assert.equal((await json(again)).error, "otp_wait");
  await sleep(1100);
  assert.equal((await call("POST", "/auth/phone/send", b.accessToken)).status, 200);
  const second = codeIn(sms[1]!.message);
  if (second !== first) assert.equal((await call("POST", "/auth/phone/verify", b.accessToken, { code: first })).status, 400, "old code is dead");
  assert.equal((await call("POST", "/auth/phone/verify", b.accessToken, { code: second })).status, 200);
  // hourly cap: 5 codes per number per hour
  const q = phone(); const c = await json(await signup(q));
  for (let i = 0; i < 4; i++) { await sleep(1100); assert.equal((await call("POST", "/auth/phone/send", c.accessToken)).status, 200); }
  await sleep(1100);
  const capped = await call("POST", "/auth/phone/send", c.accessToken);
  assert.equal(capped.status, 429); assert.equal((await json(capped)).error, "otp_limit");
});

test("WhatsApp first: delivered through the outbox (no SMS); failure or silence falls back to SMS", { skip }, async () => {
  await prisma.platformWhatsApp.upsert({ where: { id: "platform" }, create: { desired: true, status: "CONNECTED" }, update: { status: "CONNECTED" } });
  // fake wa-worker
  let mode: "send" | "fail" | "silent" = "send";
  const timer = setInterval(async () => {
    if (mode === "silent") return;
    await prisma.waOutbox.updateMany({ where: { status: "PENDING", sessionKey: "platform" }, data: mode === "send" ? { status: "SENT", sentAt: new Date() } : { status: "FAILED", lastError: "not_on_whatsapp" } });
  }, 100);
  try {
    sms.length = 0;
    const p1 = phone(); const a = await json(await signup(p1));
    assert.equal(a.verification.channel, "whatsapp"); assert.equal(sms.length, 0);
    const row = await prisma.waOutbox.findFirstOrThrow({ where: { toPhone: e164(p1) } });
    assert.match(row.text, /Nambala yanu/);
    assert.equal(row.status, "SENT");
    const wa = codeIn(row.text);
    assert.equal((await call("POST", "/auth/phone/verify", a.accessToken, { code: wa })).status, 200);

    mode = "fail";
    const p2 = phone(); const b = await json(await signup(p2));
    assert.equal(b.verification.channel, "sms"); assert.equal(sms.length, 1);

    mode = "silent"; // worker is down: must not hang forever, and must not double-send later
    const p3 = phone(); const t0 = Date.now(); const c = await json(await signup(p3));
    assert.equal(c.verification.channel, "sms"); assert.ok(Date.now() - t0 < 6000);
    assert.equal((await prisma.waOutbox.findFirstOrThrow({ where: { toPhone: e164(p3) } })).status, "CANCELLED");
  } finally { clearInterval(timer); await prisma.platformWhatsApp.update({ where: { id: "platform" }, data: { status: "DISCONNECTED" } }); }
});

test("no channel working: development echoes the code, SMS errors never fail the signup", { skip }, async () => {
  smsFail = true;
  try {
    const p = phone(); const r = await signup(p);
    assert.equal(r.status, 201);
    const b = await json(r);
    assert.equal(b.verification.channel, "dev"); assert.match(b.verification.devCode, /^\d{6}$/);
    assert.equal((await call("POST", "/auth/phone/verify", b.accessToken, { code: b.verification.devCode })).status, 200);
  } finally { smsFail = false; }
});

test("sign in with phone or email; duplicates are not revealed; typo fix before verification", { skip }, async () => {
  const p = phone();
  assert.equal((await signup(p, { email: "Mum.Phone@X.mw" })).status, 201);
  assert.equal((await signup(p)).status, 202); // same phone again: generic answer
  assert.equal((await signup(phone(), { email: "mum.phone@x.mw" })).status, 202); // same email again
  for (const identifier of [p, e164(p), p.replace(/^0/, ""), "mum.phone@x.mw"])
    assert.equal((await call("POST", "/auth/login", undefined, { identifier, password: PW })).status, 200, identifier);
  assert.equal((await call("POST", "/auth/login", undefined, { email: "mum.phone@x.mw", password: PW })).status, 200); // legacy key
  assert.equal((await call("POST", "/auth/login", undefined, { identifier: p, password: "wrong-password-1" })).status, 401);
  const login = await json(await call("POST", "/auth/login", undefined, { identifier: p, password: PW }));
  assert.equal(login.phoneVerified, false);
  await sleep(1100);
  const np = phone();
  assert.equal((await call("PATCH", "/auth/phone", login.accessToken, { phone: np })).status, 200);
  assert.equal((await call("POST", "/auth/login", undefined, { identifier: np, password: PW })).status, 200);
});

test("forgot password by phone: code, new password, old sessions revoked, no enumeration", { skip }, async () => {
  const p = phone();
  const b = await json(await signup(p));
  await sleep(1100);
  sms.length = 0;
  assert.equal((await call("POST", "/auth/forgot", undefined, { identifier: phone() })).status, 202); // unknown number
  assert.equal(sms.length, 0);
  const f = await call("POST", "/auth/forgot", undefined, { identifier: p });
  assert.equal(f.status, 202); assert.equal((await json(f)).devCode, undefined);
  assert.equal(sms.length, 1);
  const code = codeIn(sms[0]!.message);
  assert.equal((await call("POST", "/auth/reset-phone", undefined, { phone: p, code: code === "123456" ? "654321" : "123456", password: "brand-new-pass-9" })).status, 400);
  assert.equal((await call("POST", "/auth/reset-phone", undefined, { phone: p, code, password: "brand-new-pass-9" })).status, 200);
  assert.equal((await call("POST", "/auth/reset-phone", undefined, { phone: p, code, password: "another-new-pass-9" })).status, 400, "single use");
  assert.equal((await call("POST", "/auth/login", undefined, { identifier: p, password: PW })).status, 401);
  const ok = await json(await call("POST", "/auth/login", undefined, { identifier: p, password: "brand-new-pass-9" }));
  assert.equal(ok.phoneVerified, true); // receiving the reset code proves the number
  assert.equal((await call("POST", "/auth/refresh", undefined, { refreshToken: b.refreshToken })).status, 401);
});
