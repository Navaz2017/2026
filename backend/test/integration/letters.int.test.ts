import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { prisma } from "../../src/db.js";
import { app } from "../../src/app.js";
import { signAccess } from "../../src/middleware/auth.js";
import { runLetterScheduler } from "../../src/lib/decisions.js";
import { submitApplication } from "./helpers.js";

const skip = !process.env.INTEGRATION;
let server: Server, base: string, n = 0;
before(async () => {
  if (skip) return;
  await prisma.$executeRawUnsafe(`TRUNCATE "User","Institution","RevenueConfig","Notification" RESTART IDENTITY CASCADE`);
  server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await prisma.revenueConfig.create({ data: { institutionCommissionBps: 3000, studentServiceFeeBps: 3000, createdById: "x" } });
});
after(async () => { if (!skip) { server.close(); await prisma.$disconnect(); } });
const call = (method: string, path: string, token?: string, body?: unknown) =>
  fetch(`${base}/v1${path}`, { method, headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (r: Response) => r.json() as Promise<any>;

async function school(letterMode: "IMMEDIATE" | "HOLD" = "IMMEDIATE") {
  const i = ++n;
  const inst = await prisma.institution.create({ data: { name: `School ${i}`, type: "UNIVERSITY", contactEmail: `s${i}@x.mw`, status: "VERIFIED", letterMode } });
  const prog = await prisma.program.create({ data: { institutionId: inst.id, title: "BSc", level: "UG", seats: 20, applicationFee: 1_000_000, status: "ACTIVE", modes: ["FULL_TIME"] } });
  const u = await prisma.user.create({ data: { email: `reg${i}@x.mw`, passwordHash: "x", phoneVerifiedAt: new Date(), role: "INSTITUTION_ADMIN", fullName: "Registrar", institutionId: inst.id } });
  return { inst, prog, token: signAccess({ sub: u.id, role: "INSTITUTION_ADMIN", inst: inst.id, mfa: true }), plain: signAccess({ sub: u.id, role: "INSTITUTION_ADMIN", inst: inst.id }) };
}
async function applicant(s: Awaited<ReturnType<typeof school>>) {
  const i = ++n;
  const u = await prisma.user.create({ data: { email: `ap${i}@x.mw`, passwordHash: "x", phoneVerifiedAt: new Date(), role: "STUDENT", fullName: `Applicant ${i}`, student: { create: { fullName: `Applicant ${i}`, dateOfBirth: new Date("2005-01-01") } } }, include: { student: true } });
  const token = signAccess({ sub: u.id, role: "STUDENT" });
  const a = await submitApplication(call, token, u.student!.id, [s.prog.id]);
  await prisma.payment.create({ data: { applicationId: a.id, provider: "MPAMBA", reference: `REF${i}LTR${i}XY`, payerPhone: "+265881000000", amountMinor: a.totalDueMinor, status: "CONFIRMED", confirmedAt: new Date() } });
  await prisma.application.update({ where: { id: a.id }, data: { status: "SUBMITTED" } });
  return { id: a.id as string, token, userId: u.id };
}
const mine = async (ap: { token: string; id: string }) => (await json(await call("GET", "/me/applications", ap.token))).find((x: any) => x.id === ap.id);
const notes = (userId: string) => prisma.notification.count({ where: { userId, type: { startsWith: "APPLICATION_" } } });

test("immediate (default): the applicant learns of the decision at once", { skip }, async () => {
  const s = await school(), ap = await applicant(s);
  const r = await json(await call("POST", `/institution/applications/${ap.id}/decision`, s.token, { decision: "ACCEPTED", note: "Welcome" }));
  assert.equal(r.held, false);
  const v = await mine(ap);
  assert.equal(v.status, "ACCEPTED"); assert.equal(v.decisionNote, "Welcome");
  assert.equal(await notes(ap.userId), 1);
  assert.ok((await prisma.application.findUniqueOrThrow({ where: { id: ap.id } })).decisionPublishedAt);
});

test("hold: the decision is private - status, note, notification and letter stay hidden from the applicant, everywhere", { skip }, async () => {
  const s = await school(), ap = await applicant(s);
  const r = await json(await call("POST", `/institution/applications/${ap.id}/decision`, s.token, { decision: "ACCEPTED", note: "Secret until release", letter: "HOLD" }));
  assert.equal(r.held, true);
  const v = await mine(ap);
  assert.equal(v.status, "UNDER_REVIEW"); assert.equal(v.decisionNote, null); assert.equal(v.letter, null); assert.equal(v.decidedAt, undefined); assert.equal(v.decisionPublishedAt, undefined);
  assert.equal(await notes(ap.userId), 0, "no notification yet");
  const detail = await json(await call("GET", `/me/applications/${ap.id}`, ap.token));
  assert.notEqual(detail.status, "ACCEPTED"); assert.equal(detail.decisionNote ?? null, null);
  const pull = await json(await call("GET", "/sync/pull", ap.token));
  assert.ok(pull.data.applications.every((x: any) => x.status !== "ACCEPTED" && !x.decisionNote), "sync must not leak it either");
  assert.equal((await call("GET", `/me/applications/${ap.id}/letter`, ap.token)).status, 404);
  // the seat is already used, and the registrar sees it as held
  assert.equal((await prisma.program.findUniqueOrThrow({ where: { id: s.prog.id } })).seatsTaken, 1);
  const list = await json(await call("GET", "/institution/applications", s.token));
  assert.ok(list.find((x: any) => x.id === ap.id && x.status === "ACCEPTED" && x.decisionPublishedAt === null));
  // and nobody else can release it
  const other = await school();
  assert.equal((await call("POST", `/institution/applications/${ap.id}/release`, other.token)).status, 404);
});

test("release one letter; release all together (accepted and rejected), idempotent, MFA required", { skip }, async () => {
  const s = await school("HOLD"), a1 = await applicant(s), a2 = await applicant(s), a3 = await applicant(s);
  // institution default is HOLD: no `letter` field needed
  assert.equal((await json(await call("POST", `/institution/applications/${a1.id}/decision`, s.token, { decision: "ACCEPTED" }))).held, true);
  await call("POST", `/institution/applications/${a2.id}/decision`, s.token, { decision: "REJECTED" });
  await call("POST", `/institution/applications/${a3.id}/decision`, s.token, { decision: "ACCEPTED" });
  const pend = await json(await call("GET", "/institution/letters/pending", s.token));
  assert.deepEqual([pend.mode, pend.accepted, pend.rejected, pend.items.length], ["HOLD", 2, 1, 3]);
  assert.equal((await call("POST", "/institution/letters/release", s.plain)).status, 403, "needs the security code");
  assert.equal((await call("POST", `/institution/applications/${a1.id}/release`, s.token)).status, 200);
  assert.equal((await mine(a1)).status, "ACCEPTED"); assert.equal(await notes(a1.userId), 1);
  assert.equal((await mine(a2)).status, "UNDER_REVIEW");
  const all = await json(await call("POST", "/institution/letters/release", s.token));
  assert.equal(all.released, 2);
  assert.equal((await mine(a2)).status, "REJECTED"); assert.equal((await mine(a3)).status, "ACCEPTED");
  assert.deepEqual([await notes(a2.userId), await notes(a3.userId)], [1, 1]);
  assert.equal((await json(await call("POST", "/institution/letters/release", s.token))).released, 0, "second click does nothing");
  assert.equal((await call("POST", `/institution/applications/${a1.id}/release`, s.token)).status, 404, "already released");
  assert.equal(await notes(a1.userId), 1, "no duplicate notification");
});

test("schedule one release date for all held letters; other institutions are untouched; past dates refused", { skip }, async () => {
  const a = await school("HOLD"), b = await school("HOLD");
  const x = await applicant(a), y = await applicant(b);
  await call("POST", `/institution/applications/${x.id}/decision`, a.token, { decision: "ACCEPTED" });
  await call("POST", `/institution/applications/${y.id}/decision`, b.token, { decision: "ACCEPTED" });
  assert.equal((await call("PUT", "/institution/letters/settings", a.token, { mode: "HOLD", releaseAt: new Date(Date.now() - 3600_000).toISOString() })).status, 400);
  const when = new Date(Date.now() + 3600_000).toISOString();
  assert.equal((await call("PUT", "/institution/letters/settings", a.token, { mode: "HOLD", releaseAt: when })).status, 200);
  assert.equal((await json(await call("GET", "/institution/letters/pending", a.token))).releaseAt, when);
  assert.equal(await runLetterScheduler(), 0, "not yet due");
  assert.equal((await mine(x)).status, "UNDER_REVIEW");
  assert.equal(await runLetterScheduler(new Date(Date.now() + 2 * 3600_000)), 1, "the date has arrived: only school A's letter goes");
  assert.equal((await mine(x)).status, "ACCEPTED"); assert.equal((await mine(y)).status, "UNDER_REVIEW", "school B still holding");
  assert.equal((await json(await call("GET", "/institution/letters/pending", a.token))).releaseAt, null, "schedule used up");
  assert.equal(await runLetterScheduler(new Date(Date.now() + 3 * 3600_000)), 0);
  // switching back to immediate clears any date
  await call("PUT", "/institution/letters/settings", b.token, { mode: "IMMEDIATE", releaseAt: when });
  const bs = await prisma.institution.findUniqueOrThrow({ where: { id: b.inst.id } });
  assert.deepEqual([bs.letterMode, bs.lettersReleaseAt], ["IMMEDIATE", null]);
});
