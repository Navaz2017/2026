import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { hash } from "@node-rs/argon2";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { authenticate, requireMfa, requireRole } from "../middleware/auth.js";
import { body, h } from "../middleware/validate.js";
import { audit } from "../lib/audit.js";
import { csvCell, parseCsv } from "../lib/csv.js";
import { normalisePhone } from "../lib/phone.js";
import { notifyUsers } from "../lib/notify.js";
import { sendPlatformMessage } from "../lib/messaging.js";
import { commitRoster, parseRoster, rollbackRoster, rosterTemplate } from "../lib/roster.js";
import { accessibleClassIds, audienceFor, canAccessClass, canGrade, instOf } from "../lib/schoolAccess.js";

// School side of School Hub (docs/school-hub.md): admins run the school, teachers work in their own classes.
export const school = Router();
school.use(authenticate, requireRole("INSTITUTION_ADMIN", "TEACHER"));
// Primary and secondary schools only; the token must carry the school the user belongs to.
school.use(h(async (req, res, next) => {
  const i = req.user!.inst ? await prisma.institution.findUnique({ where: { id: req.user!.inst }, select: { type: true, status: true } }) : null;
  if (!i || (i.type !== "PRIMARY_SCHOOL" && i.type !== "SECONDARY_SCHOOL")) return void res.status(403).json({ error: "school_only" });
  if (i.status !== "VERIFIED") return void res.status(403).json({ error: "institution_not_verified" });
  next();
}));
const adminOnly = requireRole("INSTITUTION_ADMIN");
const year = (q: unknown) => (typeof q === "string" && /^\d{4}\/\d{4}$/.test(q) ? q : config.ACADEMIC_YEAR);
const dayOf = (s: string) => new Date(`${s}T00:00:00Z`);
const today = () => new Date().toISOString().slice(0, 10);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ------------------------------------------------------------------ staff (teachers)
school.get("/staff", adminOnly, h(async (req, res) => {
  res.json(await prisma.user.findMany({ where: { institutionId: instOf(req.user!), role: "TEACHER" }, select: { id: true, fullName: true, phone: true, phoneVerifiedAt: true, disabledAt: true, teaching: { select: { id: true, classId: true, subjectId: true, class: { select: { name: true } }, subject: { select: { name: true } } } } }, orderBy: { fullName: "asc" } }));
}));

// A teacher is added by phone number. They sign in the normal way: "Forgot password" with that number sends a code and lets them choose a password.
school.post("/staff", adminOnly, requireMfa, body(z.object({ fullName: z.string().trim().min(2).max(120), phone: z.string().min(6).max(20), email: z.string().email().optional() })), h(async (req, res) => {
  const phone = normalisePhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: "invalid_phone" });
  if (await prisma.user.findFirst({ where: { OR: [{ phone }, ...(req.body.email ? [{ email: req.body.email.toLowerCase() }] : [])] }, select: { id: true } })) return res.status(409).json({ error: "phone_taken" });
  const inst = await prisma.institution.findUniqueOrThrow({ where: { id: instOf(req.user!) }, select: { name: true } });
  const t = await prisma.user.create({ data: { fullName: req.body.fullName, phone, email: req.body.email?.toLowerCase(), role: "TEACHER", institutionId: instOf(req.user!), passwordHash: await hash(crypto.randomBytes(24).toString("hex")), consentAt: new Date() } });
  await audit(req, "school.staff_add", "User", t.id);
  void sendPlatformMessage(phone, `${inst.name} has added you as a teacher on Enrolla. Open the Enrolla app, tap "Forgot password", enter this phone number, type the code you receive and choose a password.`).catch(() => {});
  res.status(201).json({ id: t.id });
}));

school.delete("/staff/:id", adminOnly, requireMfa, h(async (req, res) => {
  const r = await prisma.user.updateMany({ where: { id: req.params.id, role: "TEACHER", institutionId: instOf(req.user!) }, data: { disabledAt: new Date() } });
  if (!r.count) return res.status(404).json({ error: "not_found" });
  await prisma.refreshToken.updateMany({ where: { userId: req.params.id }, data: { revokedAt: new Date() } });
  await audit(req, "school.staff_remove", "User", req.params.id!);
  res.status(204).end();
}));

// ------------------------------------------------------------------ classes, subjects, assignments
school.get("/classes", h(async (req, res) => {
  const ids = await accessibleClassIds(req.user!, year(req.query.year));
  res.json(await prisma.schoolClass.findMany({ where: { id: { in: ids } }, include: { classTeacher: { select: { id: true, fullName: true } }, _count: { select: { enrolments: { where: { status: "ACTIVE" } } } } }, orderBy: { name: "asc" } }));
}));

school.post("/classes", adminOnly, body(z.object({ name: z.string().trim().min(2).max(30), level: z.string().regex(/^(F[1-6]|STD[1-8])$/), academicYear: z.string().optional(), classTeacherId: z.string().uuid().nullable().optional() })), h(async (req, res) => {
  const inst = await prisma.institution.findUniqueOrThrow({ where: { id: instOf(req.user!) } });
  if ((inst.type === "SECONDARY_SCHOOL") !== req.body.level.startsWith("F")) return res.status(400).json({ error: "level_not_for_this_school" });
  if (req.body.classTeacherId && !(await prisma.user.count({ where: { id: req.body.classTeacherId, institutionId: inst.id, role: "TEACHER" } }))) return res.status(400).json({ error: "not_found" });
  try { res.status(201).json(await prisma.schoolClass.create({ data: { institutionId: inst.id, name: req.body.name, level: req.body.level, academicYear: year(req.body.academicYear), classTeacherId: req.body.classTeacherId ?? null } })); }
  catch { res.status(409).json({ error: "class_exists" }); }
}));

school.patch("/classes/:id", adminOnly, body(z.object({ classTeacherId: z.string().uuid().nullable() })), h(async (req, res) => {
  const c = await canAccessClass(req.user!, req.params.id!);
  if (!c) return res.status(404).json({ error: "not_found" });
  if (req.body.classTeacherId && !(await prisma.user.count({ where: { id: req.body.classTeacherId, institutionId: instOf(req.user!), role: "TEACHER" } }))) return res.status(400).json({ error: "not_found" });
  await prisma.schoolClass.update({ where: { id: c.id }, data: { classTeacherId: req.body.classTeacherId } });
  res.json({ ok: true });
}));

school.get("/subjects", h(async (req, res) => { res.json(await prisma.subject.findMany({ where: { institutionId: instOf(req.user!) }, orderBy: { name: "asc" } })); }));
school.post("/subjects", adminOnly, body(z.object({ name: z.string().trim().min(2).max(60) })), h(async (req, res) => {
  try { res.status(201).json(await prisma.subject.create({ data: { institutionId: instOf(req.user!), name: req.body.name } })); } catch { res.status(409).json({ error: "subject_exists" }); }
}));

school.post("/assignments", adminOnly, body(z.object({ teacherId: z.string().uuid(), classId: z.string().uuid(), subjectId: z.string().uuid().nullable().optional() })), h(async (req, res) => {
  const [c, t] = await Promise.all([canAccessClass(req.user!, req.body.classId), prisma.user.findFirst({ where: { id: req.body.teacherId, role: "TEACHER", institutionId: instOf(req.user!) } })]);
  if (!c || !t) return res.status(404).json({ error: "not_found" });
  if (req.body.subjectId && !(await prisma.subject.count({ where: { id: req.body.subjectId, institutionId: instOf(req.user!) } }))) return res.status(404).json({ error: "not_found" });
  const exists = await prisma.teachingAssignment.findFirst({ where: { teacherId: t.id, classId: c.id, subjectId: req.body.subjectId ?? null } });
  if (!exists) await prisma.teachingAssignment.create({ data: { teacherId: t.id, classId: c.id, subjectId: req.body.subjectId ?? null, academicYear: c.academicYear } });
  res.status(201).json({ ok: true });
}));
school.delete("/assignments/:id", adminOnly, h(async (req, res) => {
  const r = await prisma.teachingAssignment.deleteMany({ where: { id: req.params.id, class: { institutionId: instOf(req.user!) } } });
  r.count ? res.status(204).end() : res.status(404).json({ error: "not_found" });
}));

// ------------------------------------------------------------------ roster import (existing school -> Enrolla)
school.get("/roster/template.csv", adminOnly, h(async (_req, res) => { res.type("text/csv").set("Content-Disposition", 'attachment; filename="enrolla-roster-template.csv"').send(rosterTemplate()); }));

school.post("/roster/preview", adminOnly, body(z.object({ csv: z.string().min(10).max(3_000_000), fileName: z.string().max(200).optional(), academicYear: z.string().optional() })), h(async (req, res) => {
  const inst = await prisma.institution.findUniqueOrThrow({ where: { id: instOf(req.user!) }, select: { type: true } });
  const parsed = parseRoster(req.body.csv, inst.type as "PRIMARY_SCHOOL" | "SECONDARY_SCHOOL");
  const existing = await prisma.enrolment.findMany({ where: { institutionId: instOf(req.user!), academicYear: year(req.body.academicYear), admissionNo: { in: parsed.rows.map((r) => r.admissionNo) } }, select: { admissionNo: true } });
  const summary = { rows: parsed.rows.length, errors: parsed.errors.length, warnings: parsed.warnings.length, alreadyEnrolled: existing.length, newStudents: parsed.rows.length - existing.length, guardians: parsed.rows.reduce((n, r) => n + r.guardians.length, 0), classes: [...new Set(parsed.rows.map((r) => r.className))] };
  const imp = await prisma.rosterImport.create({ data: { institutionId: instOf(req.user!), createdById: req.user!.sub, fileName: req.body.fileName, academicYear: year(req.body.academicYear), rows: parsed.rows as any, summary: { ...summary, problems: parsed.errors, notes: parsed.warnings } as any } });
  res.json({ id: imp.id, summary, errors: parsed.errors.slice(0, 200), warnings: parsed.warnings.slice(0, 200), sample: parsed.rows.slice(0, 10) });
}));

school.post("/roster/:id/commit", adminOnly, requireMfa, h(async (req, res) => {
  const imp = await prisma.rosterImport.findFirst({ where: { id: req.params.id, institutionId: instOf(req.user!) } });
  if (!imp) return res.status(404).json({ error: "not_found" });
  if (imp.status !== "PREVIEW") return res.status(409).json({ error: "already_committed" });
  if (((imp.summary as any).errors ?? 0) > 0) return res.status(422).json({ error: "has_errors" }); // fix the file and upload again: nothing half-imported
  const claimed = await prisma.rosterImport.updateMany({ where: { id: imp.id, status: "PREVIEW" }, data: { status: "COMMITTING" } });
  if (claimed.count !== 1) return res.status(409).json({ error: "already_committed" });
  try { const stats = await commitRoster(imp.id); await audit(req, "school.roster_commit", "RosterImport", imp.id, { rows: (imp.rows as any[]).length }); res.json(stats); }
  catch (e) { await prisma.rosterImport.update({ where: { id: imp.id }, data: { status: "PREVIEW" } }); throw e; }
}));

school.post("/roster/:id/rollback", adminOnly, requireMfa, h(async (req, res) => {
  const imp = await prisma.rosterImport.findFirst({ where: { id: req.params.id, institutionId: instOf(req.user!), status: "COMMITTED" } });
  if (!imp) return res.status(404).json({ error: "not_found" });
  if ((await rollbackRoster(imp.id)) === "in_use") return res.status(409).json({ error: "import_in_use" });
  await audit(req, "school.roster_rollback", "RosterImport", imp.id);
  res.json({ ok: true });
}));

school.get("/roster/imports", adminOnly, h(async (req, res) => {
  res.json(await prisma.rosterImport.findMany({ where: { institutionId: instOf(req.user!) }, select: { id: true, status: true, fileName: true, academicYear: true, summary: true, createdAt: true, committedAt: true }, orderBy: { createdAt: "desc" }, take: 20 }));
}));

// Students of a class (or the whole school for an admin) with their guardians.
school.get("/students", h(async (req, res) => {
  const classIds = await accessibleClassIds(req.user!, year(req.query.year));
  const classId = typeof req.query.classId === "string" ? req.query.classId : undefined;
  if (classId && !classIds.includes(classId)) return res.status(404).json({ error: "not_found" });
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
  const rows = await prisma.enrolment.findMany({
    where: { institutionId: instOf(req.user!), status: "ACTIVE", classId: classId ?? { in: classIds }, ...(q && { OR: [{ admissionNo: { contains: q, mode: "insensitive" } }, { student: { fullName: { contains: q, mode: "insensitive" } } }] }) },
    select: { id: true, admissionNo: true, class: { select: { id: true, name: true } }, student: { select: { id: true, fullName: true, gender: true, dateOfBirth: true, guardianships: { where: { status: "ACTIVE" }, select: { id: true, fullName: true, phone: true, relationship: true, guardianUserId: true, blockedInstitutionIds: true } } } } },
    orderBy: { student: { fullName: "asc" } }, take: 500,
  });
  await audit(req, "school.students_view", "Institution", instOf(req.user!), { classId });
  res.json(rows.map((e) => ({ ...e, student: { ...e.student, guardianships: e.student.guardianships.map(({ blockedInstitutionIds, ...g }) => ({ ...g, blocked: blockedInstitutionIds.includes(instOf(req.user!)), linked: !!g.guardianUserId })) } })));
}));

// School admin: stop one guardian from receiving anything about this school's data (court order, safeguarding).
school.patch("/guardianships/:id", adminOnly, requireMfa, body(z.object({ blocked: z.boolean().optional(), canMessage: z.boolean().optional(), receivesNotices: z.boolean().optional(), canViewProgress: z.boolean().optional() })), h(async (req, res) => {
  const g = await prisma.guardianship.findFirst({ where: { id: req.params.id, student: { enrolments: { some: { institutionId: instOf(req.user!) } } } } });
  if (!g) return res.status(404).json({ error: "not_found" });
  const { blocked, ...flags } = req.body;
  const set = new Set(g.blockedInstitutionIds);
  if (blocked === true) set.add(instOf(req.user!)); else if (blocked === false) set.delete(instOf(req.user!));
  await prisma.guardianship.update({ where: { id: g.id }, data: { ...flags, blockedInstitutionIds: [...set] } });
  await audit(req, "school.guardian_update", "Guardianship", g.id, req.body);
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ attendance
school.get("/classes/:id/attendance", h(async (req, res) => {
  const c = await canAccessClass(req.user!, req.params.id!);
  if (!c) return res.status(404).json({ error: "not_found" });
  const date = DATE.safeParse(req.query.date).success ? String(req.query.date) : today();
  const en = await prisma.enrolment.findMany({ where: { classId: c.id, status: "ACTIVE" }, select: { id: true, admissionNo: true, student: { select: { id: true, fullName: true } }, attendance: { where: { date: dayOf(date) }, select: { status: true, note: true } } }, orderBy: { student: { fullName: "asc" } } });
  res.json({ date, class: { id: c.id, name: c.name }, students: en.map((e) => ({ enrolmentId: e.id, studentId: e.student.id, name: e.student.fullName, admissionNo: e.admissionNo, status: e.attendance[0]?.status ?? null, note: e.attendance[0]?.note ?? null })) });
}));

const STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;
school.put("/classes/:id/attendance", body(z.object({ date: DATE, marks: z.array(z.object({ enrolmentId: z.string().uuid(), status: z.enum(STATUSES), note: z.string().max(200).optional() })).min(1).max(300) })), h(async (req, res) => {
  const c = await canAccessClass(req.user!, req.params.id!);
  if (!c) return res.status(404).json({ error: "not_found" });
  if (req.body.date > today()) return res.status(400).json({ error: "date_in_future" });
  const valid = new Map((await prisma.enrolment.findMany({ where: { classId: c.id, status: "ACTIVE", id: { in: req.body.marks.map((m: any) => m.enrolmentId) } }, select: { id: true, studentId: true, student: { select: { fullName: true } } } })).map((e) => [e.id, e]));
  let saved = 0, told = 0;
  for (const m of req.body.marks as { enrolmentId: string; status: (typeof STATUSES)[number]; note?: string }[]) {
    const e = valid.get(m.enrolmentId);
    if (!e) continue; // not in this class: ignored, never written
    const row = await prisma.attendance.upsert({ where: { enrolmentId_date: { enrolmentId: m.enrolmentId, date: dayOf(req.body.date) } }, create: { enrolmentId: m.enrolmentId, date: dayOf(req.body.date), status: m.status, note: m.note, markedById: req.user!.sub }, update: { status: m.status, note: m.note, markedById: req.user!.sub } });
    saved++;
    if ((m.status === "ABSENT" || m.status === "LATE") && !row.notifiedAt) { // tell the family once per day, at once
      const { userIds } = await audienceFor([e.studentId], c.institutionId, { notices: true });
      await notifyUsers(userIds, `ATTENDANCE_${m.status}`, "", "", { studentId: e.studentId, name: e.student.fullName, date: req.body.date, institutionId: c.institutionId });
      await prisma.attendance.update({ where: { id: row.id }, data: { notifiedAt: new Date() } });
      told += userIds.length ? 1 : 0;
    }
  }
  res.json({ saved, familiesNotified: told });
}));

// ------------------------------------------------------------------ assessments, grades, personalised feedback
school.get("/assessments", h(async (req, res) => {
  const classId = z.string().uuid().optional().parse(req.query.classId);
  const ids = await accessibleClassIds(req.user!);
  if (classId && !ids.includes(classId)) return res.status(404).json({ error: "not_found" });
  res.json(await prisma.assessment.findMany({ where: { classId: classId ?? { in: ids } }, include: { subject: { select: { name: true } }, class: { select: { name: true } }, _count: { select: { grades: true } } }, orderBy: { createdAt: "desc" }, take: 200 }));
}));

school.post("/assessments", body(z.object({ classId: z.string().uuid(), subjectId: z.string().uuid(), termNo: z.number().int().min(1).max(3), title: z.string().trim().min(2).max(120), type: z.enum(["TEST", "EXAM", "ASSIGNMENT"]).default("TEST"), maxScore: z.number().int().min(1).max(1000).default(100), date: DATE.optional() })), h(async (req, res) => {
  const c = await canGrade(req.user!, req.body.classId, req.body.subjectId);
  if (!c || !(await prisma.subject.count({ where: { id: req.body.subjectId, institutionId: c.institutionId } }))) return res.status(404).json({ error: "not_found" });
  const { date, ...rest } = req.body;
  res.status(201).json(await prisma.assessment.create({ data: { ...rest, institutionId: c.institutionId, academicYear: c.academicYear, date: date ? dayOf(date) : undefined, createdById: req.user!.sub } }));
}));

const loadAssessment = async (req: any, id: string) => {
  const a = await prisma.assessment.findFirst({ where: { id, institutionId: req.user.inst ?? "-" } });
  return a && (await canGrade(req.user, a.classId, a.subjectId)) ? a : null;
};

school.get("/assessments/:id", h(async (req, res) => {
  const a = await loadAssessment(req, req.params.id!);
  if (!a) return res.status(404).json({ error: "not_found" });
  const en = await prisma.enrolment.findMany({ where: { classId: a.classId, status: "ACTIVE" }, select: { id: true, admissionNo: true, student: { select: { id: true, fullName: true } }, grades: { where: { assessmentId: a.id }, select: { score: true, feedback: true } } }, orderBy: { student: { fullName: "asc" } } });
  res.json({ assessment: a, rows: en.map((e) => ({ enrolmentId: e.id, studentId: e.student.id, name: e.student.fullName, admissionNo: e.admissionNo, score: e.grades[0]?.score ?? null, feedback: e.grades[0]?.feedback ?? null })) });
}));

async function saveGrades(assessmentId: string, maxScore: number, classId: string, items: { enrolmentId: string; score?: number | null; feedback?: string | null }[]) {
  const valid = new Set((await prisma.enrolment.findMany({ where: { classId, status: "ACTIVE", id: { in: items.map((i) => i.enrolmentId) } }, select: { id: true } })).map((e) => e.id));
  let saved = 0;
  for (const i of items) {
    if (!valid.has(i.enrolmentId)) continue;
    if (i.score != null && (i.score < 0 || i.score > maxScore)) continue;
    await prisma.grade.upsert({ where: { assessmentId_enrolmentId: { assessmentId, enrolmentId: i.enrolmentId } }, create: { assessmentId, enrolmentId: i.enrolmentId, score: i.score ?? null, feedback: i.feedback || null }, update: { ...(i.score !== undefined && { score: i.score }), ...(i.feedback !== undefined && { feedback: i.feedback || null }) } });
    saved++;
  }
  return saved;
}

school.put("/assessments/:id/grades", body(z.object({ grades: z.array(z.object({ enrolmentId: z.string().uuid(), score: z.number().nullable().optional(), feedback: z.string().max(1000).nullable().optional() })).min(1).max(300) })), h(async (req, res) => {
  const a = await loadAssessment(req, req.params.id!);
  if (!a) return res.status(404).json({ error: "not_found" });
  const bad = (req.body.grades as any[]).filter((g) => g.score != null && (g.score < 0 || g.score > a.maxScore));
  if (bad.length) return res.status(400).json({ error: "score_out_of_range", max: a.maxScore });
  res.json({ saved: await saveGrades(a.id, a.maxScore, a.classId, req.body.grades) });
}));

// Spreadsheet route: admission_no, score, feedback (Excel "Save as CSV"). Unknown admission numbers are reported, never guessed.
school.post("/assessments/:id/grades/csv", body(z.object({ csv: z.string().min(5).max(1_000_000) })), h(async (req, res) => {
  const a = await loadAssessment(req, req.params.id!);
  if (!a) return res.status(404).json({ error: "not_found" });
  const { headers, rows } = parseCsv(req.body.csv);
  if (!headers.includes("admission_no") || !headers.includes("score")) return res.status(400).json({ error: "validation", message: "columns: admission_no, score, feedback" });
  const en = new Map((await prisma.enrolment.findMany({ where: { classId: a.classId, status: "ACTIVE" }, select: { id: true, admissionNo: true } })).map((e) => [e.admissionNo, e.id]));
  const errors: { line: number; message: string }[] = [], items: { enrolmentId: string; score: number | null; feedback?: string }[] = [];
  rows.forEach((r, i) => {
    const line = i + 2, id = en.get(r.admission_no ?? "");
    if (!id) return void errors.push({ line, message: `admission_no ${r.admission_no} is not in this class` });
    const score = !r.score ? null : Number(r.score.replace(",", "."));
    if (score !== null && (isNaN(score) || score < 0 || score > a.maxScore)) return void errors.push({ line, message: `score "${r.score}" must be between 0 and ${a.maxScore}` });
    items.push({ enrolmentId: id, score, ...(r.feedback !== undefined && { feedback: r.feedback.slice(0, 1000) }) });
  });
  res.json({ saved: errors.length ? 0 : await saveGrades(a.id, a.maxScore, a.classId, items), errors, applied: !errors.length }); // all or nothing: fix the file and upload again
}));

// Families see results (and their own feedback) only after this.
school.post("/assessments/:id/publish", h(async (req, res) => {
  const a = await loadAssessment(req, req.params.id!);
  if (!a) return res.status(404).json({ error: "not_found" });
  const first = !a.publishedAt;
  if (first) await prisma.assessment.update({ where: { id: a.id }, data: { publishedAt: new Date() } });
  let told = 0;
  if (first) {
    const subject = (await prisma.subject.findUniqueOrThrow({ where: { id: a.subjectId } })).name;
    const graded = await prisma.grade.findMany({ where: { assessmentId: a.id, OR: [{ score: { not: null } }, { feedback: { not: null } }] }, select: { enrolment: { select: { studentId: true, student: { select: { fullName: true } } } } } });
    for (const g of graded) {
      const { userIds } = await audienceFor([g.enrolment.studentId], a.institutionId);
      await notifyUsers(userIds, "RESULTS_PUBLISHED", "", "", { studentId: g.enrolment.studentId, name: g.enrolment.student.fullName, title: a.title, subject, institutionId: a.institutionId, assessmentId: a.id });
      told += userIds.length;
    }
  }
  await audit(req, "school.results_publish", "Assessment", a.id);
  res.json({ published: true, notified: told });
}));

school.get("/assessments/:id/template.csv", h(async (req, res) => {
  const a = await loadAssessment(req, req.params.id!);
  if (!a) return res.status(404).json({ error: "not_found" });
  const en = await prisma.enrolment.findMany({ where: { classId: a.classId, status: "ACTIVE" }, select: { admissionNo: true, student: { select: { fullName: true } } }, orderBy: { student: { fullName: "asc" } } });
  res.type("text/csv").set("Content-Disposition", 'attachment; filename="grades-template.csv"').send(["admission_no,student_name,score,feedback", ...en.map((e) => [e.admissionNo, e.student.fullName, "", ""].map(csvCell).join(","))].join("\r\n") + "\r\n");
}));

// ------------------------------------------------------------------ announcements (in-app first, WhatsApp as the secondary copy)
school.post("/announcements", body(z.object({ title: z.string().trim().min(2).max(120), body: z.string().trim().min(2).max(2000), audience: z.enum(["SCHOOL", "CLASS"]), classIds: z.array(z.string().uuid()).max(50).default([]), urgent: z.boolean().default(false), alsoWhatsApp: z.boolean().default(false) })), h(async (req, res) => {
  const inst = instOf(req.user!);
  let classIds: string[] = [];
  if (req.body.audience === "SCHOOL") {
    if (req.user!.role !== "INSTITUTION_ADMIN") return res.status(403).json({ error: "forbidden" });
  } else {
    if (!req.body.classIds.length) return res.status(400).json({ error: "validation" });
    const ok = new Set(await accessibleClassIds(req.user!));
    if (req.body.classIds.some((c: string) => !ok.has(c))) return res.status(404).json({ error: "not_found" });
    classIds = req.body.classIds;
  }
  const students = (await prisma.enrolment.findMany({ where: { institutionId: inst, status: "ACTIVE", ...(classIds.length && { classId: { in: classIds } }) }, select: { studentId: true } })).map((e) => e.studentId);
  const { userIds, phones } = await audienceFor(students, inst, { notices: true });
  const a = await prisma.announcement.create({ data: { institutionId: inst, authorId: req.user!.sub, title: req.body.title, body: req.body.body, audience: req.body.audience, classIds, urgent: req.body.urgent, alsoWhatsApp: req.body.alsoWhatsApp, recipients: userIds.length } });
  await notifyUsers(userIds, "ANNOUNCEMENT", a.title, a.body, { announcementId: a.id, institutionId: inst, urgent: a.urgent }); // the app is always the first channel
  let whatsapp = 0;
  if (a.alsoWhatsApp && (await prisma.whatsAppSession.findUnique({ where: { institutionId: inst } }))?.status === "CONNECTED") {
    const name = (await prisma.institution.findUniqueOrThrow({ where: { id: inst }, select: { name: true } })).name;
    const text = `${a.urgent ? "URGENT - " : ""}${name}: ${a.title}\n${a.body}`.slice(0, 1500);
    for (const phone of phones.slice(0, 500)) { await prisma.waOutbox.create({ data: { sessionKey: inst, toPhone: phone, text } }); whatsapp++; } // also reaches guardians who have no account yet
  }
  await audit(req, "school.announcement", "Announcement", a.id, { audience: a.audience, recipients: userIds.length, whatsapp });
  res.status(201).json({ id: a.id, inApp: userIds.length, whatsapp });
}));

school.get("/announcements", h(async (req, res) => {
  const ids = await accessibleClassIds(req.user!);
  const rows = await prisma.announcement.findMany({ where: { institutionId: instOf(req.user!), ...(req.user!.role === "TEACHER" && { OR: [{ audience: "SCHOOL" }, { classIds: { hasSome: ids } }] }) }, include: { _count: { select: { reads: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  res.json(rows.map(({ _count, ...a }) => ({ ...a, reads: _count.reads })));
}));
