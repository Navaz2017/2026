import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { prisma } from "../../src/db.js";
import { app } from "../../src/app.js";
import { signAccess } from "../../src/middleware/auth.js";
import { localWrite } from "../../src/lib/storage.js";
import { sampleForm, saveSections, submitApplication } from "./helpers.js";

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

async function uni(programs: { title: string; fee: number; modes?: string[] }[], campuses: string[] = []) {
  const i = ++n;
  const inst = await prisma.institution.create({ data: { name: `College ${i}`, type: "COLLEGE", contactEmail: `c${i}@x.mw`, status: "VERIFIED", campuses } });
  const progs = [];
  for (const p of programs) progs.push(await prisma.program.create({ data: { institutionId: inst.id, title: p.title, level: "Degree", seats: 5, applicationFee: p.fee, tuitionFeeMinor: 80_000_000, tuitionPeriod: "SEMESTER", duration: "4 years", modes: p.modes ?? ["FULL_TIME"], status: "ACTIVE" } }));
  const admin = await prisma.user.create({ data: { email: `ca${i}@x.mw`, passwordHash: "x", phoneVerifiedAt: new Date(), role: "INSTITUTION_ADMIN", fullName: "A", institutionId: inst.id } });
  return { inst, progs, adminToken: signAccess({ sub: admin.id, role: "INSTITUTION_ADMIN", inst: inst.id, mfa: true }) };
}
async function applicant() {
  const i = ++n;
  const u = await prisma.user.create({ data: { email: `ap${i}@x.mw`, passwordHash: "x", phoneVerifiedAt: new Date(), role: "STUDENT", fullName: "A", student: { create: { fullName: "A", dateOfBirth: new Date("2005-01-01") } } }, include: { student: true } });
  return { token: signAccess({ sub: u.id, role: "STUDENT" }), studentId: u.student!.id, userId: u.id };
}

test("colleges: max 3 choices, all from ONE institution, ranked; fee = highest chosen fee", { skip }, async () => {
  const u = await uni([{ title: "BBA", fee: 1_000_000 }, { title: "BSc IT", fee: 2_000_000 }, { title: "BA HR", fee: 1_500_000 }, { title: "BSc Fin", fee: 1_000_000 }]);
  const other = await uni([{ title: "Other", fee: 1_000_000 }]);
  const a = await applicant();
  const d = await json(await call("POST", "/me/applications/draft", a.token, { studentId: a.studentId, programId: u.progs[0]!.id }));
  assert.equal((await call("PUT", `/me/applications/${d.id}/choices`, a.token, { programIds: u.progs.map((p) => p.id) })).status, 400); // 4 > 3
  assert.equal((await call("PUT", `/me/applications/${d.id}/choices`, a.token, { programIds: [u.progs[0]!.id, other.progs[0]!.id] })).status, 422); // other institution
  assert.equal((await call("PUT", `/me/applications/${d.id}/choices`, a.token, { programIds: [u.progs[0]!.id, u.progs[0]!.id] })).status, 400); // duplicate
  const ok = await json(await call("PUT", `/me/applications/${d.id}/choices`, a.token, { programIds: [u.progs[0]!.id, u.progs[1]!.id, u.progs[2]!.id] }));
  assert.equal(ok.feeMinor, 2_000_000); // highest of the three, even though rank 1 is cheaper
  assert.equal(ok.totalDueMinor, 2_600_000);
  const detail = await json(await call("GET", `/me/applications/${d.id}`, a.token));
  assert.deepEqual(detail.choices.map((c: any) => [c.rank, c.program.title]), [[1, "BBA"], [2, "BSc IT"], [3, "BA HR"]]);
  assert.equal(detail.maxChoices, 3);
  assert.equal(detail.programId, u.progs[0]!.id);
});

test("one application per institution per year; draft resumes; cannot re-apply after submit", { skip }, async () => {
  const u = await uni([{ title: "BBA", fee: 1_000_000 }, { title: "BSc IT", fee: 1_000_000 }]);
  const a = await applicant();
  const d1 = await call("POST", "/me/applications/draft", a.token, { studentId: a.studentId, programId: u.progs[0]!.id });
  assert.equal(d1.status, 201);
  const d2 = await call("POST", "/me/applications/draft", a.token, { studentId: a.studentId, programId: u.progs[1]!.id });
  assert.equal(d2.status, 200); // resumes the same draft instead of creating a second application
  assert.equal((await json(d2)).id, (await json(d1)).id);
  const sub = await submitApplication(call, a.token, a.studentId, [u.progs[0]!.id], { awaitingPayment: true });
  assert.equal((await prisma.application.findUniqueOrThrow({ where: { id: sub.id } })).status, "AWAITING_PAYMENT"); // (payment was rejected -> must pay again)
  assert.equal((await call("POST", "/me/applications/draft", a.token, { studentId: a.studentId, programId: u.progs[1]!.id })).status, 200); // still unpaid: resume
  await prisma.application.update({ where: { id: sub.id }, data: { status: "SUBMITTED" } });
  assert.equal((await call("POST", "/me/applications/draft", a.token, { studentId: a.studentId, programId: u.progs[1]!.id })).status, 409);
});

test("submit reports every missing step; bio data is remembered for the next application", { skip }, async () => {
  const u = await uni([{ title: "BBA", fee: 1_000_000 }]), u2 = await uni([{ title: "BSc", fee: 1_000_000 }]);
  const a = await applicant();
  const d = await json(await call("POST", "/me/applications/draft", a.token, { studentId: a.studentId, programId: u.progs[0]!.id }));
  const bad = await call("POST", `/me/applications/${d.id}/submit`, a.token);
  assert.equal(bad.status, 422);
  const miss = (await json(bad)).missing.map((m: any) => m.step);
  for (const step of ["personal", "education", "guardian", "study", "sponsor", "review", "documents"]) assert.ok(miss.includes(step), `expected ${step} in ${miss}`);
  assert.equal((await call("PUT", `/me/applications/${d.id}/section/personal`, a.token, { surname: "Only" })).status, 400); // a step must be valid to save
  assert.equal((await call("PUT", `/me/applications/${d.id}/section/personal?partial=1`, a.token, { surname: "Only" })).status, 200); // "save & exit"
  await saveSections(call, a.token, d.id, sampleForm(false));
  const s = await prisma.student.findUniqueOrThrow({ where: { id: a.studentId } });
  assert.equal((s.profile as any).surname, "Banda"); assert.equal(s.fullName, "Test Banda");
  const d2 = await json(await call("POST", "/me/applications/draft", a.token, { studentId: a.studentId, programId: u2.progs[0]!.id }));
  assert.equal((await json(await call("GET", `/me/applications/${d2.id}`, a.token))).student.profile.nationalId, "AB123456"); // prefill source
});

test("study mode and campus must be ones the institution offers", { skip }, async () => {
  const u = await uni([{ title: "BBA", fee: 1_000_000, modes: ["WEEKEND"] }], ["Blantyre", "Lilongwe"]);
  const a = await applicant();
  const d = await json(await call("POST", "/me/applications/draft", a.token, { studentId: a.studentId, programId: u.progs[0]!.id }));
  await saveSections(call, a.token, d.id, sampleForm(false, "FULL_TIME")); // FULL_TIME is not offered
  const ids = [(await prisma.credential.create({ data: { studentId: a.studentId, kind: "ID", title: "ID", storageKey: "k1", sha256: "0".repeat(64), mime: "application/pdf" } })).id, (await prisma.credential.create({ data: { studentId: a.studentId, kind: "MSCE", title: "C", storageKey: "k2", sha256: "0".repeat(64), mime: "application/pdf" } })).id];
  await call("PUT", `/me/applications/${d.id}/documents`, a.token, { credentialIds: ids });
  const r = await json(await call("POST", `/me/applications/${d.id}/submit`, a.token));
  assert.deepEqual(r.missing.map((m: any) => m.message).sort(), ["campus", "mode"]);
  await call("PUT", `/me/applications/${d.id}/section/study`, a.token, { mode: "WEEKEND", campus: "Lilongwe" });
  assert.equal((await call("POST", `/me/applications/${d.id}/submit`, a.token)).status, 200);
});

test("schools: institution declares highest class; class levels only up to it; Cambridge needed above Form 4", { skip }, async () => {
  const i = ++n;
  const inst = await prisma.institution.create({ data: { name: `Sec ${i}`, type: "SECONDARY_SCHOOL", contactEmail: `s${i}@x.mw`, status: "VERIFIED" } });
  const adm = await prisma.user.create({ data: { email: `sa${i}@x.mw`, passwordHash: "x", phoneVerifiedAt: new Date(), role: "INSTITUTION_ADMIN", fullName: "A", institutionId: inst.id } });
  const t = signAccess({ sub: adm.id, role: "INSTITUTION_ADMIN", inst: inst.id, mfa: true });
  const prog = (classLevel: string, syllabus?: string) => call("POST", "/institution/programs", t, { title: "xx", level: "xx", seats: 40, applicationFee: 500_000, tuitionFeeMinor: 9_000_000, tuitionPeriod: "TERM", classLevel, syllabus });
  assert.equal((await prog("F1", "MSCE")).status, 422);                       // must declare highest level first
  assert.equal((await call("PATCH", "/institution/me", t, { highestLevel: "STD8" })).status, 422); // primary level on a secondary school
  assert.equal((await call("PATCH", "/institution/me", t, { highestLevel: "F6", syllabi: ["MSCE"] })).status, 422); // Form 5-6 needs Cambridge
  assert.equal((await call("PATCH", "/institution/me", t, { highestLevel: "F4", syllabi: ["MSCE"] })).status, 200);
  const f2 = await json(await prog("F2", "MSCE"));
  assert.equal(f2.title, "Form 2 (MSCE)"); assert.equal(f2.tuitionPeriod, "TERM"); assert.equal(f2.classLevel, "F2");
  assert.equal((await prog("F2", "MSCE")).status, 409);                       // duplicate level
  assert.equal((await prog("F5", "CAMBRIDGE")).status, 422);                  // above declared highest
  assert.equal((await prog("F3", "CAMBRIDGE")).status, 422);                  // syllabus not offered
  assert.equal((await call("PATCH", "/institution/me", t, { highestLevel: "F6", syllabi: ["MSCE", "CAMBRIDGE"] })).status, 200);
  assert.equal((await prog("F5", "CAMBRIDGE")).status, 201);
  assert.equal((await prog("F5", "MSCE")).status, 422);                       // Form 5 does not exist under MSCE
});

test("schools: one class level only; Standard 1 needs no report; others need report or grades request", { skip }, async () => {
  const i = ++n;
  const prim = await prisma.institution.create({ data: { name: `Prim ${i}`, type: "PRIMARY_SCHOOL", contactEmail: `p${i}@x.mw`, status: "VERIFIED", highestLevel: "STD8" } });
  const std1 = await prisma.program.create({ data: { institutionId: prim.id, title: "Standard 1", level: "Standard 1", classLevel: "STD1", seats: 50, applicationFee: 300_000, status: "ACTIVE" } });
  const std4 = await prisma.program.create({ data: { institutionId: prim.id, title: "Standard 4", level: "Standard 4", classLevel: "STD4", seats: 50, applicationFee: 300_000, status: "ACTIVE" } });
  const prev = await prisma.institution.create({ data: { name: `Prev ${i}`, type: "PRIMARY_SCHOOL", contactEmail: `pv${i}@x.mw`, status: "VERIFIED" } });
  const a = await applicant();
  const d = await json(await call("POST", "/me/applications/draft", a.token, { studentId: a.studentId, programId: std4.id }));
  assert.equal((await call("PUT", `/me/applications/${d.id}/choices`, a.token, { programIds: [std4.id, std1.id] })).status, 422); // schools: exactly one
  const form = sampleForm(true);
  await saveSections(call, a.token, d.id, { ...form, education: { ...form.education, previousSchoolId: prev.id, previousSchoolName: prev.name, requestGrades: false } });
  const noDocs = await json(await call("POST", `/me/applications/${d.id}/submit`, a.token));
  assert.deepEqual(noDocs.missing.map((m: any) => m.message), ["school_report"]);
  await call("PUT", `/me/applications/${d.id}/section/education`, a.token, { ...form.education, previousSchoolId: prev.id, previousSchoolName: prev.name, requestGrades: true });
  assert.equal((await call("POST", `/me/applications/${d.id}/submit`, a.token)).status, 200); // grades requested from the platform school instead
  const gr = await prisma.gradeRequest.findFirstOrThrow({ where: { studentId: a.studentId } });
  assert.equal(gr.fromSchoolId, prev.id); assert.equal(gr.toSchoolId, prim.id);
  // Standard 1: no previous school or report needed
  const b = await applicant();
  const first = await submitApplication(call, b.token, b.studentId, [std1.id], { school: true, skipDocs: true }).catch((e) => e);
  assert.equal(first.status, "PAYMENT_SUBMITTED", String(first?.message));
});

test("accepting offers one of the ranked choices and uses that programme's seat", { skip }, async () => {
  const u = await uni([{ title: "BBA", fee: 1_000_000 }, { title: "BSc IT", fee: 1_000_000 }]);
  const a = await applicant();
  const sub = await submitApplication(call, a.token, a.studentId, u.progs.map((p) => p.id));
  await prisma.application.update({ where: { id: sub.id }, data: { status: "SUBMITTED" } });
  const stranger = await prisma.program.create({ data: { institutionId: u.inst.id, title: "Not chosen", level: "x", seats: 5, applicationFee: 1, status: "ACTIVE" } });
  assert.equal((await call("POST", `/institution/applications/${sub.id}/decision`, u.adminToken, { decision: "ACCEPTED", programId: stranger.id })).status, 400);
  assert.equal((await call("POST", `/institution/applications/${sub.id}/decision`, u.adminToken, { decision: "ACCEPTED", programId: u.progs[1]!.id })).status, 200);
  assert.equal((await prisma.program.findUniqueOrThrow({ where: { id: u.progs[1]!.id } })).seatsTaken, 1);
  assert.equal((await prisma.program.findUniqueOrThrow({ where: { id: u.progs[0]!.id } })).seatsTaken, 0);
  assert.equal((await prisma.application.findUniqueOrThrow({ where: { id: sub.id } })).offeredProgramId, u.progs[1]!.id);
});

test("tuition is returned publicly; public school page shows only approved media, preview shows all; media is embeddable", { skip }, async () => {
  const u = await uni([{ title: "BBA", fee: 1_000_000 }]);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
  await localWrite("inst/x/media/a", png, "image/png"); await localWrite("inst/x/media/b", png, "image/png");
  await prisma.media.createMany({ data: [{ institutionId: u.inst.id, kind: "IMAGE", caption: "Library", storageKey: "inst/x/media/a", approved: true }, { institutionId: u.inst.id, kind: "IMAGE", caption: "Pending", storageKey: "inst/x/media/b", approved: false }] });
  const pub = await json(await call("GET", `/public/institutions/${u.inst.id}`));
  assert.deepEqual(pub.media.map((m: any) => m.caption), ["Library"]);
  assert.equal(pub.programs[0].tuitionFeeMinor, 80_000_000); assert.equal(pub.programs[0].totalDueMinor, 1_300_000);
  const prev = await json(await call("GET", "/institution/preview", u.adminToken));
  assert.deepEqual(prev.media.map((m: any) => m.caption).sort(), ["Library", "Pending"]);
  const img = await fetch(pub.media[0].url.replace(/^https?:\/\/[^/]+/, base));
  assert.equal(img.status, 200); assert.equal(img.headers.get("content-type"), "image/png");
  assert.equal(img.headers.get("cross-origin-resource-policy"), "cross-origin"); // otherwise browsers refuse to show it on the web app
  const list = await json(await call("GET", "/public/programs"));
  assert.ok(list.every((p: any) => "tuitionFeeMinor" in p && "totalDueMinor" in p));
});

test("colleges/universities can create a programme with tuition, modes and entry requirements (the dashboard's payload)", { skip }, async () => {
  const u = await uni([]);
  // exactly what the web form posts for a university
  const r = await call("POST", "/institution/programs", u.adminToken, { title: "BSc Nursing", level: "Undergraduate", seats: 30, applicationFee: 1_000_000, tuitionFeeMinor: 90_000_000, tuitionPeriod: "SEMESTER", modes: ["FULL_TIME"], code: "BSN", duration: "4 years", entryRequirements: "Six MSCE credits", description: "x" });
  assert.equal(r.status, 201, await r.clone().text());
  const p = await json(r);
  assert.deepEqual([p.title, p.tuitionFeeMinor, p.status, p.classLevel], ["BSc Nursing", 90_000_000, "ACTIVE", null]);
  // minimal payload (all optional fields left out / empty)
  const min = await call("POST", "/institution/programs", u.adminToken, { title: "Diploma in IT", level: "Diploma", seats: 20, applicationFee: 500_000, tuitionFeeMinor: 0, tuitionPeriod: "YEAR", modes: [] });
  assert.equal(min.status, 201, await min.clone().text());
});

test("the transaction ID is entered BEFORE submitting: required, recorded with the submit, one-time, phone comes from the account", { skip }, async () => {
  const u = await uni([{ title: "BSc", fee: 1_000_000 }]), a = await applicant();
  const d = await json(await call("POST", "/me/applications/draft", a.token, { studentId: a.studentId, programId: u.progs[0]!.id }));
  const form = sampleForm(false) as Record<string, any>;
  const { payment, ...noPay } = form;
  await saveSections(call, a.token, d.id, noPay);
  await prisma.credential.createMany({ data: ["ID", "MSCE"].map((kind) => ({ studentId: a.studentId, kind, title: kind, storageKey: `students/${a.studentId}/creds/${kind}-${d.id}`, sha256: "0".repeat(64), mime: "application/pdf" })) });
  const ids = (await prisma.credential.findMany({ where: { studentId: a.studentId } })).map((c) => c.id);
  await call("PUT", `/me/applications/${d.id}/documents`, a.token, { credentialIds: ids });
  const bad = await json(await call("POST", `/me/applications/${d.id}/submit`, a.token));
  assert.deepEqual(bad.missing.map((m: any) => m.step), ["payment"], "only the payment is missing");
  assert.equal((await call("PUT", `/me/applications/${d.id}/section/payment`, a.token, { provider: "CASH", reference: "ABC123456", payerPhone: "0881000000" })).status, 400);
  assert.equal((await call("PUT", `/me/applications/${d.id}/section/payment`, a.token, { provider: "AIRTEL_MONEY", reference: "ab", payerPhone: "0881000000" })).status, 400);
  assert.equal((await call("PUT", `/me/applications/${d.id}/section/payment`, a.token, { provider: "AIRTEL_MONEY", reference: "BW260929.1403.PL4887", payerPhone: "0881000000" })).status, 200);
  const ok = await json(await call("POST", `/me/applications/${d.id}/submit`, a.token));
  assert.equal(ok.status, "PAYMENT_SUBMITTED");
  const p = await prisma.payment.findFirstOrThrow({ where: { applicationId: d.id } });
  assert.deepEqual([p.provider, p.reference, p.payerPhone, p.status, p.amountMinor], ["AIRTEL_MONEY", "BW260929.1403.PL4887", "+265881000000", "PENDING", ok.totalDueMinor]);
  // the same transaction ID cannot be used by someone else: their submit is refused and stays a draft
  const b = await applicant();
  const d2 = await json(await call("POST", "/me/applications/draft", b.token, { studentId: b.studentId, programId: u.progs[0]!.id }));
  await saveSections(call, b.token, d2.id, { ...noPay, payment: { provider: "AIRTEL_MONEY", reference: "bw260929.1403.pl4887", payerPhone: "0881000000" } });
  const cred = await prisma.credential.createMany({ data: ["ID", "MSCE"].map((kind) => ({ studentId: b.studentId, kind, title: kind, storageKey: `students/${b.studentId}/creds/${kind}-${d2.id}`, sha256: "0".repeat(64), mime: "application/pdf" })) });
  void cred;
  await call("PUT", `/me/applications/${d2.id}/documents`, b.token, { credentialIds: (await prisma.credential.findMany({ where: { studentId: b.studentId } })).map((c) => c.id) });
  const dup = await call("POST", `/me/applications/${d2.id}/submit`, b.token);
  assert.equal(dup.status, 409); assert.equal((await json(dup)).error, "reference_already_used");
  assert.equal((await prisma.application.findUniqueOrThrow({ where: { id: d2.id } })).status, "DRAFT");
});

test("phone numbers are never asked twice: the personal (and, for a parent, guardian) phone is the account's own", { skip }, async () => {
  const u = await uni([{ title: "BSc", fee: 1_000_000 }]), a = await applicant();
  await prisma.user.update({ where: { id: a.userId }, data: { phone: "+265999000321" } });
  const d = await json(await call("POST", "/me/applications/draft", a.token, { studentId: a.studentId, programId: u.progs[0]!.id }));
  const { phone: _p, ...personalNoPhone } = (sampleForm(false) as any).personal;
  assert.equal((await call("PUT", `/me/applications/${d.id}/section/personal`, a.token, personalNoPhone)).status, 200);
  const stored = (await prisma.application.findUniqueOrThrow({ where: { id: d.id } })).form as any;
  assert.equal(stored.personal.phone, "+265999000321", "filled from the account");
  assert.equal(stored.personal.traditionalAuthority, undefined);
});

test("uploads: a too-big photo or an unsupported type gets a clear 400 (not a bare 'something went wrong')", { skip }, async () => {
  const a = await applicant();
  const slot = (mime: string, size: number) => call("POST", `/me/students/${a.studentId}/credentials/upload-url`, a.token, { mime, size });
  assert.equal((await slot("image/jpeg", 9_000_000)).status, 200, "a 9 MB phone photo is fine now");
  const big = await slot("image/jpeg", 30_000_000); assert.equal(big.status, 400); assert.equal((await json(big)).error, "file_too_large");
  const heic = await slot("image/heic", 1_000_000); assert.equal(heic.status, 400); assert.equal((await json(heic)).error, "file_type_not_allowed");
  assert.equal((await slot("application/pdf", 5_000_000)).status, 200);
});

test("a parent applying for a child is the guardian: the guardian phone is the parent's account phone", { skip }, async () => {
  const u = await uni([{ title: "BSc", fee: 1_000_000 }]);
  const i = ++n;
  const parent = await prisma.user.create({ data: { email: `par${i}@x.mw`, phone: `+2658877${String(10000 + i)}`, passwordHash: "x", phoneVerifiedAt: new Date(), role: "PARENT", fullName: "Mayi", parent: { create: { occupation: "Farmer" } } }, include: { parent: true } });
  const child = await prisma.student.create({ data: { parentId: parent.parent!.id, fullName: "Child", dateOfBirth: new Date("2008-01-01") } });
  const token = signAccess({ sub: parent.id, role: "PARENT" });
  const d = await json(await call("POST", "/me/applications/draft", token, { studentId: child.id, programId: u.progs[0]!.id }));
  const { phone: _gp, ...g } = (sampleForm(false) as any).guardian;
  assert.equal((await call("PUT", `/me/applications/${d.id}/section/guardian`, token, g)).status, 200);
  assert.equal(((await prisma.application.findUniqueOrThrow({ where: { id: d.id } })).form as any).guardian.phone, parent.phone);
});
