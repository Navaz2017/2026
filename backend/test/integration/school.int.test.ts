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
  await prisma.$executeRawUnsafe(`TRUNCATE "User","Institution","Student","Notification","WaOutbox","RevenueConfig" RESTART IDENTITY CASCADE`);
  server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { if (!skip) { server.close(); await prisma.$disconnect(); } });
const call = (method: string, path: string, token?: string, body?: unknown) =>
  fetch(`${base}/v1${path}`, { method, headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (r: Response) => r.json() as Promise<any>;
const phone = () => `+26599${String(5_000_000 + ++n)}`;
const local = (p: string) => "0" + p.slice(4);

async function school(type: "SECONDARY_SCHOOL" | "PRIMARY_SCHOOL" | "COLLEGE" = "SECONDARY_SCHOOL") {
  const i = ++n;
  const inst = await prisma.institution.create({ data: { name: `School ${i}`, type, contactEmail: `s${i}@x.mw`, status: "VERIFIED" } });
  const admin = await prisma.user.create({ data: { email: `adm${i}@x.mw`, passwordHash: "x", phoneVerifiedAt: new Date(), role: "INSTITUTION_ADMIN", fullName: "Head", institutionId: inst.id } });
  return { inst, admin, token: signAccess({ sub: admin.id, role: "INSTITUTION_ADMIN", inst: inst.id, mfa: true }), plain: signAccess({ sub: admin.id, role: "INSTITUTION_ADMIN", inst: inst.id }) };
}
async function teacher(s: Awaited<ReturnType<typeof school>>) {
  const r = await call("POST", "/school/staff", s.token, { fullName: "Mr Teacher", phone: local(phone()) });
  assert.equal(r.status, 201);
  const id = (await json(r)).id as string;
  return { id, token: signAccess({ sub: id, role: "TEACHER", inst: s.inst.id }) };
}
async function parent(ph: string, fullName = "Mayi") {
  const i = ++n;
  const u = await prisma.user.create({ data: { email: `par${i}@x.mw`, phone: ph, passwordHash: "x", phoneVerifiedAt: new Date(), role: "PARENT", fullName, parent: { create: { occupation: "Farmer" } } } });
  return { id: u.id, token: signAccess({ sub: u.id, role: "PARENT" }) };
}
const csv = (rows: string[]) => ["admission_no,student_name,date_of_birth,gender,class,guardian1_name,guardian1_phone,guardian1_relationship,guardian2_name,guardian2_phone,guardian2_relationship", ...rows].join("\n");
async function importRoster(s: Awaited<ReturnType<typeof school>>, rows: string[]) {
  const p = await json(await call("POST", "/school/roster/preview", s.token, { csv: csv(rows), fileName: "r.csv" }));
  assert.equal(p.summary.errors, 0, JSON.stringify(p.errors));
  const c = await call("POST", `/school/roster/${p.id}/commit`, s.token);
  assert.equal(c.status, 200);
  return { id: p.id as string, ...(await json(c)) };
}
const notes = (userId: string, type: string) => prisma.notification.count({ where: { userId, type } });

test("roster preview reports every problem and commits nothing; template is downloadable; college admins are refused", { skip }, async () => {
  const s = await school();
  assert.match(await (await call("GET", "/school/roster/template.csv", s.token)).text(), /admission_no,student_name/);
  const p = await json(await call("POST", "/school/roster/preview", s.token, { csv: csv([
    "A1,Good Kid,2010-03-25,M,Form 1A,Mayi,0999111222,Mother,,,",
    "A1,Twin Number,2010-03-25,M,Form 1A,,,,,,",        // duplicate admission no
    "A3,Bad Date,25/03/2010,M,Form 1A,,,,,,",           // wrong date format
    "A4,Wrong Class,2010-03-25,M,Standard 5A,,,,,,",    // primary class in a secondary school
    "A5,Nonsense,2010-03-25,M,Room 7,,,,,,",            // unrecognised class
    "A6,Too Old,1980-03-25,M,Form 1A,,,,,,",            // age
    "A7,Bad Phone,2010-03-25,F,Form 2B,Mayi,123,Mother,,,",
  ]) }));
  assert.equal(p.summary.errors, 5); assert.equal(p.summary.warnings, 2);
  assert.ok(p.errors.every((e: any) => e.line >= 3));
  assert.equal(await prisma.enrolment.count({ where: { institutionId: s.inst.id } }), 0, "preview saves nothing");
  assert.equal((await call("POST", `/school/roster/${p.id}/commit`, s.token)).status, 422, "cannot commit a file with errors");
  const college = await school("COLLEGE");
  assert.equal((await call("GET", "/school/classes", college.token)).status, 403);
  assert.equal((await call("GET", "/school/classes", (await parent(phone())).token)).status, 403);
});

test("import links guardians through their PHONE; existing accounts are linked at once, others when they sign in; admissions children are matched, not duplicated", { skip }, async () => {
  const s = await school();
  const mum = phone(), dad = phone(), later = phone();
  const registered = await parent(mum, "Mayi Banda");
  // this child already exists in Enrolla (added by the mother for admissions)
  const known = await prisma.student.create({ data: { fullName: "Chikondi Banda", dateOfBirth: new Date("2010-03-25T00:00:00Z"), parentId: (await prisma.parentProfile.findUniqueOrThrow({ where: { userId: registered.id } })).id } });
  const r = await importRoster(s, [
    `M1,Chikondi Banda,2010-03-25,M,Form 1A,Mayi Banda,${local(mum)},Mother,Bambo Banda,${local(dad)},Father`,
    `M2,Tadala Phiri,2008-11-02,F,form 3b,Mrs Phiri,${local(later)},Guardian,,,`,
  ]);
  assert.deepEqual([r.newStudents, r.matchedStudents], [1, 1]);
  assert.equal(await prisma.student.count({ where: { fullName: "Chikondi Banda" } }), 1, "no duplicate child");
  assert.equal((await prisma.enrolment.findFirstOrThrow({ where: { admissionNo: "M1" } })).studentId, known.id);
  assert.deepEqual((await prisma.schoolClass.findMany({ where: { institutionId: s.inst.id }, orderBy: { name: "asc" } })).map((c) => [c.name, c.level]), [["Form 1A", "F1"], ["Form 3B", "F3"]]);
  // mum is already registered: her child shows up straight away
  const kids = await json(await call("GET", "/me/school/children", registered.token));
  assert.equal(kids.length, 1); assert.equal(kids[0].enrolments[0].class.name, "Form 1A"); assert.equal(kids[0].enrolments[0].institution.id, s.inst.id);
  // dad signs up later with the number the school had: linked when he logs in
  const g = await prisma.guardianship.findFirstOrThrow({ where: { phone: dad } });
  assert.equal(g.guardianUserId, null);
  const dadUser = await parent(dad, "Bambo");
  assert.equal((await json(await call("GET", "/me/school/children", dadUser.token))).length, 1);
  assert.equal((await prisma.guardianship.findFirstOrThrow({ where: { phone: dad } })).guardianUserId, dadUser.id);
  // a STRANGER with another number sees nothing
  assert.deepEqual(await json(await call("GET", "/me/school/children", (await parent(phone())).token)), []);
  // re-importing the same file changes nothing (idempotent on admission number)
  const again = await importRoster(s, [`M1,Chikondi Banda,2010-03-25,M,Form 1A,Mayi Banda,${local(mum)},Mother,Bambo Banda,${local(dad)},Father`]);
  assert.deepEqual([again.updated, again.newStudents, again.guardiansLinked], [1, 0, 0]);
  assert.equal(await prisma.guardianship.count({ where: { studentId: known.id } }), 2);
  // a parent with children at TWO schools sees both under one account
  const s2 = await school();
  await importRoster(s2, [`Z9,Chikondi Banda,2010-03-25,M,Form 2A,Mayi Banda,${local(mum)},Mother,,,`]);
  const both = await json(await call("GET", "/me/school/children", registered.token));
  assert.deepEqual(both[0].enrolments.map((e: any) => e.institution.id).sort(), [s.inst.id, s2.inst.id].sort());
});

test("commit/rollback need the security code; rollback removes only what the import created, and refuses once school data exists", { skip }, async () => {
  const s = await school(), t = await teacher(s);
  const p = await json(await call("POST", "/school/roster/preview", s.plain, { csv: csv([`R1,Roll Back,2010-01-01,M,Form 1A,Mayi,${local(phone())},Mother,,,`]) }));
  assert.equal((await call("POST", `/school/roster/${p.id}/commit`, s.plain)).status, 403);
  assert.equal((await call("POST", `/school/roster/${p.id}/commit`, t.token)).status, 403, "teachers cannot import");
  await call("POST", `/school/roster/${p.id}/commit`, s.token);
  assert.equal((await call("POST", `/school/roster/${p.id}/commit`, s.token)).status, 409);
  assert.equal((await call("POST", `/school/roster/${p.id}/rollback`, s.token)).status, 200);
  assert.deepEqual([await prisma.enrolment.count({ where: { institutionId: s.inst.id } }), await prisma.student.count({ where: { fullName: "Roll Back" } })], [0, 0]);
  const keep = await importRoster(s, [`R2,Keep Me,2010-01-01,M,Form 1A,Mayi,${local(phone())},Mother,,,`]);
  const cls = await prisma.schoolClass.findFirstOrThrow({ where: { institutionId: s.inst.id } });
  const en = await prisma.enrolment.findFirstOrThrow({ where: { admissionNo: "R2" } });
  await call("PUT", `/school/classes/${cls.id}/attendance`, s.token, { date: new Date().toISOString().slice(0, 10), marks: [{ enrolmentId: en.id, status: "PRESENT" }] });
  assert.equal((await call("POST", `/school/roster/${keep.id}/rollback`, s.token)).status, 409, "attendance already recorded");
});

test("teachers: added by phone, see only their own classes, cannot touch other classes or post school-wide", { skip }, async () => {
  const s = await school(), other = await school();
  const t1 = await teacher(s), t2 = await teacher(s);
  assert.equal((await call("POST", "/school/staff", s.token, { fullName: "Dup", phone: (await prisma.user.findUniqueOrThrow({ where: { id: t1.id } })).phone! })).status, 409);
  await importRoster(s, ["T1,Kid One,2010-01-01,M,Form 1A,Mayi,0999000001,Mother,,,", "T2,Kid Two,2010-01-01,F,Form 2A,Mayi,0999000002,Mother,,,"]);
  const [c1, c2] = await prisma.schoolClass.findMany({ where: { institutionId: s.inst.id }, orderBy: { name: "asc" } });
  const maths = await json(await call("POST", "/school/subjects", s.token, { name: "Mathematics" }));
  assert.equal((await call("POST", "/school/assignments", s.token, { teacherId: t1.id, classId: c1!.id, subjectId: maths.id })).status, 201);
  assert.equal((await call("POST", "/school/assignments", s.token, { teacherId: t1.id, classId: c1!.id, subjectId: maths.id })).status, 201, "idempotent");
  assert.equal((await call("POST", "/school/assignments", other.token, { teacherId: t1.id, classId: c1!.id })).status, 404, "another school's admin cannot assign");
  assert.deepEqual((await json(await call("GET", "/school/classes", t1.token))).map((c: any) => c.name), ["Form 1A"]);
  assert.deepEqual(await json(await call("GET", "/school/classes", t2.token)), []);
  assert.equal((await call("GET", `/school/classes/${c2!.id}/attendance`, t1.token)).status, 404);
  assert.equal((await call("GET", `/school/classes/${c1!.id}/attendance`, t1.token)).status, 200);
  assert.equal((await call("GET", `/school/classes/${c1!.id}/attendance`, other.token)).status, 404, "other school");
  assert.equal((await call("POST", "/school/announcements", t1.token, { title: "Hi", body: "All school", audience: "SCHOOL" })).status, 403);
  assert.equal((await call("POST", "/school/announcements", t1.token, { title: "Hi", body: "Class 2", audience: "CLASS", classIds: [c2!.id] })).status, 404);
  assert.deepEqual((await json(await call("GET", "/school/students", t1.token))).map((e: any) => e.admissionNo), ["T1"]);
  assert.equal((await call("GET", `/school/students?classId=${c2!.id}`, t1.token)).status, 404);
  assert.equal((await call("DELETE", `/school/staff/${t2.id}`, s.token)).status, 204);
});

test("attendance: marking absent tells ALL the child's guardians once; future dates and strangers' children are refused", { skip }, async () => {
  const s = await school(), t = await teacher(s);
  const mum = phone(), dad = phone();
  const m = await parent(mum), d = await parent(dad), outsider = await parent(phone());
  await importRoster(s, [`AT1,Absent Kid,2010-01-01,M,Form 1A,Mum,${local(mum)},Mother,Dad,${local(dad)},Father`, "AT2,Present Kid,2010-01-01,F,Form 1A,X,0999000009,Mother,,,"]);
  const c = await prisma.schoolClass.findFirstOrThrow({ where: { institutionId: s.inst.id } });
  await call("POST", "/school/assignments", s.token, { teacherId: t.id, classId: c.id });
  const sheet = await json(await call("GET", `/school/classes/${c.id}/attendance`, t.token));
  const a1 = sheet.students.find((x: any) => x.admissionNo === "AT1"), a2 = sheet.students.find((x: any) => x.admissionNo === "AT2");
  const day = new Date().toISOString().slice(0, 10);
  assert.equal((await call("PUT", `/school/classes/${c.id}/attendance`, t.token, { date: "2999-01-01", marks: [{ enrolmentId: a1.enrolmentId, status: "ABSENT" }] })).status, 400);
  const foreign = await prisma.enrolment.create({ data: { studentId: (await prisma.student.create({ data: { fullName: "Foreign", dateOfBirth: new Date("2010-01-01") } })).id, institutionId: s.inst.id, academicYear: "2026/2027", admissionNo: "NOCLASS" } });
  const r = await json(await call("PUT", `/school/classes/${c.id}/attendance`, t.token, { date: day, marks: [{ enrolmentId: a1.enrolmentId, status: "ABSENT", note: "sick" }, { enrolmentId: a2.enrolmentId, status: "PRESENT" }, { enrolmentId: foreign.id, status: "ABSENT" }] }));
  assert.equal(r.saved, 2, "an enrolment outside the class is ignored");
  assert.deepEqual([await notes(m.id, "ATTENDANCE_ABSENT"), await notes(d.id, "ATTENDANCE_ABSENT"), await notes(outsider.id, "ATTENDANCE_ABSENT")], [1, 1, 0]);
  const note = await prisma.notification.findFirstOrThrow({ where: { userId: m.id, type: "ATTENDANCE_ABSENT" } });
  assert.equal((note.data as any).name, "Absent Kid");
  await call("PUT", `/school/classes/${c.id}/attendance`, t.token, { date: day, marks: [{ enrolmentId: a1.enrolmentId, status: "ABSENT" }] });
  assert.equal(await notes(m.id, "ATTENDANCE_ABSENT"), 1, "marking again does not re-notify");
  // the family sees it
  const kid = (await json(await call("GET", "/me/school/children", d.token)))[0];
  const att = await json(await call("GET", `/me/school/children/${kid.id}/attendance?institutionId=${s.inst.id}`, d.token));
  assert.deepEqual([att.summary.absent, att.summary.marked, att.records[0].status], [1, 1, "ABSENT"]);
  assert.equal((await call("GET", `/me/school/children/${kid.id}/attendance?institutionId=${s.inst.id}`, outsider.token)).status, 404);
});

test("results: entered by the subject teacher, hidden until published, personal feedback reaches student + every guardian; blocked guardians see nothing", { skip }, async () => {
  const s = await school(), t = await teacher(s), stranger = await teacher(s);
  const mum = phone(), dad = phone();
  const m = await parent(mum), d = await parent(dad);
  await importRoster(s, [`G1,Grace Mwale,2008-05-05,F,Form 3A,Mum,${local(mum)},Mother,Dad,${local(dad)},Father`, "G2,Peter Zulu,2008-05-05,M,Form 3A,X,0999000008,Mother,,,"]);
  const c = await prisma.schoolClass.findFirstOrThrow({ where: { institutionId: s.inst.id } });
  const maths = await json(await call("POST", "/school/subjects", s.token, { name: "Mathematics" }));
  const eng = await json(await call("POST", "/school/subjects", s.token, { name: "English" }));
  await call("POST", "/school/assignments", s.token, { teacherId: t.id, classId: c.id, subjectId: maths.id });
  const mk = (tok: string, subjectId: string, title = "Test 1") => call("POST", "/school/assessments", tok, { classId: c.id, subjectId, termNo: 1, title, type: "TEST", maxScore: 50 });
  assert.equal((await mk(stranger.token, maths.id)).status, 404, "not their class");
  assert.equal((await mk(t.token, eng.id)).status, 404, "not their subject");
  const a = await json(await mk(t.token, maths.id));
  const sheet = await json(await call("GET", `/school/assessments/${a.id}`, t.token));
  const grace = sheet.rows.find((r: any) => r.admissionNo === "G1"), peter = sheet.rows.find((r: any) => r.admissionNo === "G2");
  assert.equal((await call("PUT", `/school/assessments/${a.id}/grades`, t.token, { grades: [{ enrolmentId: grace.enrolmentId, score: 51 }] })).status, 400, "above the maximum");
  assert.equal((await call("PUT", `/school/assessments/${a.id}/grades`, t.token, { grades: [{ enrolmentId: grace.enrolmentId, score: 41, feedback: "Excellent algebra, Grace. Practise word problems." }, { enrolmentId: peter.enrolmentId, score: 20 }] })).status, 200);
  // spreadsheet route is all-or-nothing and reports unknown admission numbers
  const bad = await json(await call("POST", `/school/assessments/${a.id}/grades/csv`, t.token, { csv: "admission_no,score,feedback\nG2,25,Better\nNOPE,10," }));
  assert.deepEqual([bad.applied, bad.errors.length], [false, 1]);
  const good = await json(await call("POST", `/school/assessments/${a.id}/grades/csv`, t.token, { csv: "admission_no;score;feedback\nG2;25,5;Much better, Peter" }));
  assert.equal(good.applied, true, "semicolon CSV with a decimal comma applies");
  const ok = await json(await call("POST", `/school/assessments/${a.id}/grades/csv`, t.token, { csv: 'admission_no,score,feedback\nG2,25,"Much better, Peter"' }));
  assert.deepEqual([ok.applied, ok.saved], [true, 1]);
  const kid = (await json(await call("GET", "/me/school/children", m.token)))[0];
  const prog = () => call("GET", `/me/school/children/${kid.id}/progress?institutionId=${s.inst.id}`, m.token).then(json);
  assert.deepEqual((await prog()).subjects, [], "unpublished results are invisible");
  assert.equal((await call("POST", `/school/assessments/${a.id}/publish`, stranger.token)).status, 404);
  const pub = await json(await call("POST", `/school/assessments/${a.id}/publish`, t.token));
  assert.equal(pub.published, true); assert.ok(pub.notified >= 2);
  assert.deepEqual([await notes(m.id, "RESULTS_PUBLISHED"), await notes(d.id, "RESULTS_PUBLISHED")], [1, 1]);
  assert.equal((await json(await call("POST", `/school/assessments/${a.id}/publish`, t.token))).notified, 0, "publishing twice does not re-notify");
  const p = await prog();
  const row = p.subjects[0];
  assert.deepEqual([row.subject, row.items[0].score, row.items[0].percent, row.items[0].grade, row.average, p.overallAverage, p.level], ["Mathematics", 41, 82, 1, 82, 82, "F3"]);
  assert.match(row.items[0].feedback, /Excellent algebra/);
  // the other guardian sees the same personal feedback; the school can block a guardian
  const dKid = (await json(await call("GET", "/me/school/children", d.token)))[0];
  assert.match((await json(await call("GET", `/me/school/children/${dKid.id}/progress?institutionId=${s.inst.id}`, d.token))).subjects[0].items[0].feedback, /Excellent algebra/);
  const g = await prisma.guardianship.findFirstOrThrow({ where: { phone: dad } });
  assert.equal((await call("PATCH", `/school/guardianships/${g.id}`, s.plain, { blocked: true })).status, 403, "needs the security code");
  assert.equal((await call("PATCH", `/school/guardianships/${g.id}`, s.token, { blocked: true })).status, 200);
  assert.equal((await call("GET", `/me/school/children/${dKid.id}/progress?institutionId=${s.inst.id}`, d.token)).status, 404);
  assert.deepEqual((await json(await call("GET", "/me/school/children", d.token)))[0].enrolments, [], "the school shows a blocked guardian nothing");
  // a student with their own account sees only their own results
  const own = await prisma.user.create({ data: { email: `stu${++n}@x.mw`, passwordHash: "x", phoneVerifiedAt: new Date(), role: "STUDENT", fullName: "Grace Mwale" } });
  await prisma.student.update({ where: { id: kid.id }, data: { userId: own.id } });
  const st = signAccess({ sub: own.id, role: "STUDENT" });
  assert.equal((await call("GET", `/me/school/children/${kid.id}/progress?institutionId=${s.inst.id}`, st)).status, 200);
  const peterId = (await prisma.enrolment.findFirstOrThrow({ where: { admissionNo: "G2" } })).studentId;
  assert.equal((await call("GET", `/me/school/children/${peterId}/progress?institutionId=${s.inst.id}`, st)).status, 404);
});

test("announcements: in-app first for the right families only; WhatsApp is a secondary copy (also to guardians with no account yet); read receipts", { skip }, async () => {
  const s = await school(), t = await teacher(s);
  const mum1 = phone(), mum2 = phone(), noAccount = phone();
  const p1 = await parent(mum1), p2 = await parent(mum2);
  await importRoster(s, [`N1,Kid A,2010-01-01,M,Form 1A,Mum,${local(mum1)},Mother,Aunt,${local(noAccount)},Aunt`, `N2,Kid B,2010-01-01,F,Form 2A,Mum,${local(mum2)},Mother,,,`]);
  const [c1, c2] = await prisma.schoolClass.findMany({ where: { institutionId: s.inst.id }, orderBy: { name: "asc" } });
  await call("POST", "/school/assignments", s.token, { teacherId: t.id, classId: c1!.id });
  // class announcement by that class's teacher, WhatsApp requested but the school's number is not linked: app only
  let r = await json(await call("POST", "/school/announcements", t.token, { title: "Maths trip", body: "Bring MK2000 on Friday", audience: "CLASS", classIds: [c1!.id], alsoWhatsApp: true }));
  assert.deepEqual([r.inApp, r.whatsapp], [1, 0]);
  assert.deepEqual([await notes(p1.id, "ANNOUNCEMENT"), await notes(p2.id, "ANNOUNCEMENT")], [1, 0]);
  assert.equal(await prisma.waOutbox.count({ where: { sessionKey: s.inst.id } }), 0);
  // school linked its WhatsApp: urgent whole-school notice goes to the app AND, as a copy, to every guardian phone
  await prisma.whatsAppSession.create({ data: { institutionId: s.inst.id, desired: true, status: "CONNECTED", phone: "+265999000000" } });
  r = await json(await call("POST", "/school/announcements", s.token, { title: "Storm warning", body: "School closes at 10:00 today", audience: "SCHOOL", urgent: true, alsoWhatsApp: true }));
  assert.deepEqual([r.inApp, r.whatsapp], [2, 3]);
  assert.deepEqual([await notes(p1.id, "ANNOUNCEMENT"), await notes(p2.id, "ANNOUNCEMENT")], [2, 1]);
  const wa = await prisma.waOutbox.findMany({ where: { sessionKey: s.inst.id } });
  assert.ok(wa.some((w) => w.toPhone === noAccount) && wa.every((w) => /^URGENT - School \d+: Storm warning/.test(w.text)));
  // family view: child-scoped, with read receipts
  const kid = (await json(await call("GET", "/me/school/children", p1.token)))[0];
  const list = await json(await call("GET", `/me/school/children/${kid.id}/announcements?institutionId=${s.inst.id}`, p1.token));
  assert.deepEqual(list.map((a: any) => a.title).sort(), ["Maths trip", "Storm warning"]);
  const kid2 = (await json(await call("GET", "/me/school/children", p2.token)))[0];
  assert.deepEqual((await json(await call("GET", `/me/school/children/${kid2.id}/announcements?institutionId=${s.inst.id}`, p2.token))).map((a: any) => a.title), ["Storm warning"], "other class's notice is not shown");
  assert.equal((await call("POST", `/me/school/announcements/${list[0].id}/read`, p1.token)).status, 204);
  assert.equal((await call("POST", `/me/school/announcements/${list[0].id}/read`, (await parent(phone())).token)).status, 404, "not a parent of this school");
  const staffList = await json(await call("GET", "/school/announcements", s.token));
  assert.equal(staffList.reduce((n: number, a: any) => n + a.reads, 0), 1);
  assert.equal((await json(await call("GET", "/school/announcements", t.token))).length, 2);
  // a guardian the school blocked hears nothing
  await prisma.guardianship.updateMany({ where: { guardianUserId: p2.id }, data: { blockedInstitutionIds: [s.inst.id] } });
  await call("POST", "/school/announcements", s.token, { title: "Fees", body: "Term 2 fees", audience: "SCHOOL" });
  assert.equal(await notes(p2.id, "ANNOUNCEMENT"), 1);
});
