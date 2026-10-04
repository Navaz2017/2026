import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { prisma } from "../../src/db.js";
import { app } from "../../src/app.js";
import { signAccess } from "../../src/middleware/auth.js";
import { currentCode } from "../../src/lib/totp.js";
import { decrypt } from "../../src/lib/crypto.js";
import { outbox } from "../../src/lib/mailer.js";
import { submitApplication } from "./helpers.js";

const skip = !process.env.INTEGRATION;
let server: Server, base: string, n = 0;

before(async () => {
  if (skip) return;
  await prisma.$executeRawUnsafe(`TRUNCATE "User","Institution","Device","RevenueConfig" RESTART IDENTITY CASCADE`);
  server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await prisma.revenueConfig.create({ data: { institutionCommissionBps: 3000, studentServiceFeeBps: 3000, createdById: "x" } });
});
after(async () => { if (!skip) { server.close(); await prisma.$disconnect(); } });

const call = (method: string, path: string, token?: string, body?: unknown) =>
  fetch(`${base}/v1${path}`, { method, headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (r: Response) => r.json() as Promise<any>;

async function world(opts: { seats?: number; verified?: boolean } = {}) {
  const i = ++n;
  const inst = await prisma.institution.create({ data: { name: `=Uni ${i}`, type: "UNIVERSITY", contactEmail: `u${i}@x.mw`, status: opts.verified === false ? "PENDING" : "VERIFIED", payoutProvider: "AIRTEL_MONEY", payoutPhone: "+265999000111" } });
  const prog = await prisma.program.create({ data: { institutionId: inst.id, title: "BSc", level: "UG", seats: opts.seats ?? 5, applicationFee: 1_000_000, status: "ACTIVE" } });
  const admin = await prisma.user.create({ data: { email: `adm${i}@x.mw`, passwordHash: "x", role: "INSTITUTION_ADMIN", fullName: "Adm", institutionId: inst.id } });
  const adminToken = signAccess({ sub: admin.id, role: "INSTITUTION_ADMIN", inst: inst.id, mfa: true });
  const adminNoMfa = signAccess({ sub: admin.id, role: "INSTITUTION_ADMIN", inst: inst.id });
  return { inst, prog, admin, adminToken, adminNoMfa };
}

async function paidApplication(w: Awaited<ReturnType<typeof world>>, withCredential = false) {
  const i = ++n;
  const u = await prisma.user.create({ data: { email: `st${i}@x.mw`, passwordHash: "x", role: "STUDENT", fullName: `Student ${i}`, phone: `+26599${String(i).padStart(7, "0")}`, student: { create: { fullName: `Student ${i}`, dateOfBirth: new Date("2006-02-02") } } }, include: { student: true } });
  const token = signAccess({ sub: u.id, role: "STUDENT" });
  let credentialId: string | undefined;
  if (withCredential) {
    const bytes = Buffer.from("%PDF-1.4 fake report card");
    const up = await json(await call("POST", `/me/students/${u.student!.id}/credentials/upload-url`, token, { mime: "application/pdf", size: bytes.length }));
    const put = await fetch(up.url.replace(/^https?:\/\/[^/]+/, base), { method: "PUT", headers: up.headers, body: bytes });
    assert.equal(put.status, 200);
    const c = await call("POST", `/me/students/${u.student!.id}/credentials`, token, { key: up.key, mime: "application/pdf", size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), kind: "SCHOOL_REPORT", title: "Term 3 report" });
    assert.equal(c.status, 201);
    credentialId = (await json(c)).id;
  }
  const a = await submitApplication(call, token, u.student!.id, [w.prog.id], { credentialIds: credentialId ? [credentialId] : undefined });
  const pay = await prisma.payment.create({ data: { applicationId: a.id, provider: "MPAMBA", reference: `REF${i}ABCDEF`, payerPhone: "+265881000000", amountMinor: a.totalDueMinor, status: "CONFIRMED", confirmedAt: new Date() } });
  await prisma.application.update({ where: { id: a.id }, data: { status: "SUBMITTED" } });
  return { id: a.id as string, token, credentialId, student: u.student!, payment: pay };
}

test("signup needs consent; MFA setup/enable/login flow; institution admin blocked from sensitive actions until MFA", { skip }, async () => {
  const body = { email: "head@school.mw", password: "very-long-password", fullName: "Head Teacher", role: "INSTITUTION_ADMIN", language: "ny", institution: { name: "Zomba Sec", type: "SECONDARY_SCHOOL", contactEmail: "z@s.mw" } };
  assert.equal((await call("POST", "/auth/signup", undefined, body)).status, 400); // no consent
  const ok = await call("POST", "/auth/signup", undefined, { ...body, consent: true });
  assert.equal(ok.status, 201);
  const t = await json(ok);
  assert.equal(t.language, "ny");
  // sensitive endpoint refuses a non-MFA session
  assert.equal((await call("POST", "/institution/whatsapp/connect", t.accessToken)).status, 403);
  const setup = await json(await call("POST", "/auth/mfa/setup", t.accessToken));
  assert.equal((await call("POST", "/auth/mfa/enable", t.accessToken, { code: "000000" })).status, 400);
  const en = await json(await call("POST", "/auth/mfa/enable", t.accessToken, { code: currentCode(setup.secret) }));
  const me = await json(await call("GET", "/auth/me", en.accessToken));
  assert.equal(me.mfa, true);
  assert.equal(me.language, "ny");
  // stored secret is encrypted at rest
  const row = await prisma.user.findUniqueOrThrow({ where: { email: "head@school.mw" } });
  assert.notEqual(row.mfaSecret, setup.secret);
  assert.equal(decrypt(row.mfaSecret!), setup.secret);
  // login: password alone -> mfa_required; wrong code -> 401; right code -> mfa session
  assert.equal((await json(await call("POST", "/auth/login", undefined, { email: "head@school.mw", password: "very-long-password" }))).error, "mfa_required");
  assert.equal((await call("POST", "/auth/login", undefined, { email: "head@school.mw", password: "very-long-password", code: "123456" })).status, 401);
  const li = await json(await call("POST", "/auth/login", undefined, { email: "head@school.mw", password: "very-long-password", code: currentCode(setup.secret) }));
  assert.equal((await json(await call("GET", "/auth/me", li.accessToken))).mfa, true);
  // refresh keeps the MFA flag
  const rf = await json(await call("POST", "/auth/refresh", undefined, { refreshToken: li.refreshToken }));
  assert.equal((await json(await call("GET", "/auth/me", rf.accessToken))).mfa, true);
});

test("owner endpoints require MFA", { skip }, async () => {
  const o = await prisma.user.create({ data: { email: "own@x.mw", passwordHash: "x", role: "SYSTEM_OWNER", fullName: "O" } });
  assert.equal((await call("GET", "/admin/dashboard", signAccess({ sub: o.id, role: "SYSTEM_OWNER" }))).status, 403);
  assert.equal((await call("GET", "/admin/dashboard", signAccess({ sub: o.id, role: "SYSTEM_OWNER", mfa: true }))).status, 200);
});

test("institution views applicant file + credential via signed URL; others cannot; view is audited", { skip }, async () => {
  const w = await world(), other = await world();
  const a = await paidApplication(w, true);
  const list = await json(await call("GET", "/institution/applications", w.adminToken));
  assert.ok(list.some((x: any) => x.id === a.id));
  const detail = await json(await call("GET", `/institution/applications/${a.id}`, w.adminToken));
  assert.ok(detail.credentials.some((c: any) => c.id === a.credentialId) && detail.credentials.length >= 1);
  assert.equal(detail.form.personal.surname, "Banda"); // the full form is visible to the institution
  assert.equal(detail.choices.length, 1);
  assert.equal(JSON.stringify(detail).includes("storageKey"), false);
  assert.equal((await call("GET", `/institution/applications/${a.id}/credentials/${a.credentialId}/download`, w.adminNoMfa)).status, 403);
  const dl = await json(await call("GET", `/institution/applications/${a.id}/credentials/${a.credentialId}/download`, w.adminToken));
  const file = await fetch(dl.url.replace(/^https?:\/\/[^/]+/, base));
  assert.equal(await file.text(), "%PDF-1.4 fake report card");
  assert.equal((await fetch(dl.url.replace(/^https?:\/\/[^/]+/, base).slice(0, -3) + "abc")).status, 403); // tampered token
  assert.equal((await call("GET", `/institution/applications/${a.id}`, other.adminToken)).status, 404);
  assert.equal((await call("GET", `/institution/applications/${a.id}/credentials/${a.credentialId}/download`, other.adminToken)).status, 404);
  assert.equal(await prisma.auditLog.count({ where: { action: "credential.view", entityId: a.credentialId } }), 1);
});

test("unpaid applications are invisible to the institution", { skip }, async () => {
  const w = await world();
  const a = await paidApplication(w);
  await prisma.application.update({ where: { id: a.id }, data: { status: "PAYMENT_SUBMITTED" } });
  assert.equal((await call("GET", `/institution/applications/${a.id}`, w.adminToken)).status, 404);
});

test("accepting is seat-limited and atomic; rejection always possible; applicant notified", { skip }, async () => {
  const w = await world({ seats: 1 });
  const [a, b, c] = [await paidApplication(w), await paidApplication(w), await paidApplication(w)];
  assert.equal((await call("POST", `/institution/applications/${a.id}/decision`, w.adminNoMfa, { decision: "ACCEPTED" })).status, 403);
  const results = await Promise.all([a, b].map((x) => call("POST", `/institution/applications/${x.id}/decision`, w.adminToken, { decision: "ACCEPTED" }).then((r) => r.status)));
  assert.deepEqual(results.sort(), [200, 409]); // exactly one wins the last seat
  assert.equal((await prisma.program.findUniqueOrThrow({ where: { id: w.prog.id } })).seatsTaken, 1);
  assert.equal((await call("POST", `/institution/applications/${c.id}/decision`, w.adminToken, { decision: "REJECTED", note: "Incomplete" })).status, 200);
  assert.equal((await call("POST", `/institution/applications/${c.id}/decision`, w.adminToken, { decision: "ACCEPTED" })).status, 404); // already decided
  assert.equal(await prisma.notification.count({ where: { userId: c.student.userId!, type: "APPLICATION_REJECTED" } }), 1);
});

test("institution dashboard summarises applications, seats and earnings", { skip }, async () => {
  const w = await world();
  await paidApplication(w); await paidApplication(w);
  const d = await json(await call("GET", "/institution/dashboard", w.adminToken));
  assert.equal(d.applicationsByStatus.find((x: any) => x.status === "SUBMITTED")._count, 2);
  assert.equal(d.earnings.pendingNetMinor, 2 * 700_000);
  assert.equal(d.programs[0].seats, 5);
});

test("whatsapp linking: needs verified institution + MFA, records desired state, never leaks QR when not in QR state", { skip }, async () => {
  const unverified = await world({ verified: false });
  assert.equal((await call("POST", "/institution/whatsapp/connect", unverified.adminToken)).status, 403);
  const w = await world();
  assert.equal((await call("POST", "/institution/whatsapp/connect", w.adminToken)).status, 202);
  let s = await json(await call("GET", "/institution/whatsapp", w.adminToken));
  assert.deepEqual([s.desired, s.status, s.qr], [true, "STARTING", null]);
  await prisma.whatsAppSession.update({ where: { institutionId: w.inst.id }, data: { status: "QR", qr: "2@abc" } }); // what the wa-worker does
  s = await json(await call("GET", "/institution/whatsapp", w.adminToken));
  assert.equal(s.qr, "2@abc");
  await prisma.whatsAppSession.update({ where: { institutionId: w.inst.id }, data: { status: "CONNECTED", qr: null, phone: "+265999000111" } });
  assert.equal((await json(await call("GET", "/institution/whatsapp", w.adminToken))).qr, null);
  assert.equal((await call("POST", "/institution/whatsapp/disconnect", w.adminToken)).status, 202);
  assert.equal((await json(await call("GET", "/institution/whatsapp", w.adminToken))).desired, false);
});

test("owner: manual confirm needs a reason, is audited, notifies; reject frees the application", { skip }, async () => {
  const o = await prisma.user.create({ data: { email: `own${++n}@x.mw`, passwordHash: "x", role: "SYSTEM_OWNER", fullName: "O" } });
  const tok = signAccess({ sub: o.id, role: "SYSTEM_OWNER", mfa: true });
  const w = await world();
  const a = await paidApplication(w);
  await prisma.payment.update({ where: { id: a.payment.id }, data: { status: "PENDING", confirmedAt: null } });
  await prisma.application.update({ where: { id: a.id }, data: { status: "PAYMENT_SUBMITTED" } });
  assert.equal((await call("POST", `/admin/payments/${a.payment.id}/manual-confirm`, tok, { reason: "short" })).status, 400);
  assert.equal((await call("POST", `/admin/payments/${a.payment.id}/manual-confirm`, tok, { reason: "Phone was off; checked Airtel statement" })).status, 200);
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: a.payment.id } });
  assert.deepEqual([p.status, p.confirmedById, !!p.manualReason], ["CONFIRMED", o.id, true]);
  assert.equal((await prisma.application.findUniqueOrThrow({ where: { id: a.id } })).status, "SUBMITTED");
  assert.equal((await call("POST", `/admin/payments/${a.payment.id}/manual-confirm`, tok, { reason: "Second time should fail" })).status, 409);
  assert.equal(await prisma.auditLog.count({ where: { action: "payment.manual_confirm", entityId: p.id } }), 1);

  const b = await paidApplication(w);
  await prisma.payment.update({ where: { id: b.payment.id }, data: { status: "PENDING" } });
  await prisma.application.update({ where: { id: b.id }, data: { status: "PAYMENT_SUBMITTED" } });
  assert.equal((await call("POST", `/admin/payments/${b.payment.id}/reject`, tok, { reason: "Reference not found" })).status, 200);
  assert.equal((await prisma.application.findUniqueOrThrow({ where: { id: b.id } })).status, "AWAITING_PAYMENT");
});

test("owner: review verifies institution + activates early programs; timeseries; settlements + CSV is formula-safe", { skip }, async () => {
  const o = await prisma.user.create({ data: { email: `own${++n}@x.mw`, passwordHash: "x", role: "SYSTEM_OWNER", fullName: "O" } });
  const tok = signAccess({ sub: o.id, role: "SYSTEM_OWNER", mfa: true });
  const w = await world({ verified: false });
  await prisma.program.update({ where: { id: w.prog.id }, data: { status: "PENDING_VERIFICATION" } });
  assert.equal((await call("POST", `/admin/institutions/${w.inst.id}/review`, tok, { decision: "VERIFIED" })).status, 200);
  assert.equal((await prisma.program.findUniqueOrThrow({ where: { id: w.prog.id } })).status, "ACTIVE");
  await paidApplication(w);

  const ts = await json(await call("GET", "/admin/stats/timeseries?months=6", tok));
  assert.equal(ts.length, 6);
  assert.ok(ts[5].ownerRevenueMinor >= 600_000 && ts[5].confirmedPayments >= 1);

  const month = new Date().toISOString().slice(0, 7);
  const run = await json(await call("POST", "/admin/settlements/run", tok, { month }));
  const mine = run.find((s: any) => s.institutionId === w.inst.id);
  assert.deepEqual([mine.grossFeesMinor, mine.commissionMinor, mine.netPayableMinor], [1_000_000, 300_000, 700_000]);
  const again = await json(await call("POST", "/admin/settlements/run", tok, { month }));
  assert.equal(again.length, 0); // idempotent: nothing left to settle
  const csv = await (await call("GET", `/admin/settlements/export.csv?month=${month}`, tok)).text();
  assert.ok(csv.includes(`"'=Uni`)); // institution name starting with "=" is neutralised
  assert.ok(csv.includes("7000"));
  const d = await json(await call("GET", "/admin/dashboard", tok));
  assert.ok(Array.isArray(d.alerts));
});

test("password reset: single use, signs out all sessions, no account enumeration", { skip }, async () => {
  await call("POST", "/auth/signup", undefined, { email: "mum@x.mw", password: "old-password-123", fullName: "Mum", role: "PARENT", occupation: "Farmer", consent: true, language: "tum" });
  assert.equal((await call("POST", "/auth/forgot", undefined, { email: "nobody@x.mw" })).status, 202);
  assert.equal(outbox.filter((m) => m.to === "nobody@x.mw").length, 0);
  assert.equal((await call("POST", "/auth/forgot", undefined, { email: "mum@x.mw" })).status, 202);
  const token = outbox.filter((m) => m.to === "mum@x.mw").at(-1)!.text.match(/token=([\w-]+)/)![1];
  assert.equal((await call("POST", "/auth/reset", undefined, { token, password: "brand-new-password" })).status, 200);
  assert.equal((await call("POST", "/auth/reset", undefined, { token, password: "another-password-1" })).status, 400);
  assert.equal((await call("POST", "/auth/login", undefined, { email: "mum@x.mw", password: "old-password-123" })).status, 401);
  assert.equal((await call("POST", "/auth/login", undefined, { email: "mum@x.mw", password: "brand-new-password" })).status, 200);
});

test("language preference is stored", { skip }, async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: "mum@x.mw" } });
  const tok = signAccess({ sub: u.id, role: "PARENT" });
  assert.equal((await json(await call("GET", "/auth/me", tok))).language, "tum");
  assert.equal((await call("PATCH", "/auth/me", tok, { language: "ny" })).status, 200);
  assert.equal((await json(await call("GET", "/auth/me", tok))).language, "ny");
  assert.equal((await call("PATCH", "/auth/me", tok, { language: "fr" })).status, 400);
});
