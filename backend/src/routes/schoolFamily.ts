import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { h } from "../middleware/validate.js";
import { gradeFor, percentOf } from "../lib/grading.js";
import { childAccess, linkGuardianships } from "../lib/schoolAccess.js";

// What a guardian (or the student themselves) sees of school life. Every route re-checks the link to THAT child and
// that the school has not blocked this guardian. Staff routes are in school.ts.
export const schoolFamily = Router();
schoolFamily.use(authenticate, requireRole("PARENT", "STUDENT"));

// Children, with the school(s) and class each is enrolled in. A parent can have children at several schools.
schoolFamily.get("/children", h(async (req, res) => {
  await linkGuardianships(req.user!.sub); // a roster may have been waiting for this phone number
  const studentIds = req.user!.role === "STUDENT"
    ? (await prisma.student.findMany({ where: { userId: req.user!.sub }, select: { id: true } })).map((s) => s.id)
    : (await prisma.guardianship.findMany({ where: { guardianUserId: req.user!.sub, status: "ACTIVE" }, select: { studentId: true } })).map((g) => g.studentId);
  const rows = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, fullName: true, enrolments: { where: { status: "ACTIVE" }, select: { id: true, admissionNo: true, academicYear: true, institution: { select: { id: true, name: true } }, class: { select: { id: true, name: true, level: true } } }, orderBy: { joinedAt: "desc" } } },
    orderBy: { fullName: "asc" },
  });
  const mineG = req.user!.role === "PARENT" ? await prisma.guardianship.findMany({ where: { guardianUserId: req.user!.sub, studentId: { in: studentIds } } }) : [];
  res.json(rows.map((s) => {
    const g = mineG.find((x) => x.studentId === s.id);
    return { id: s.id, fullName: s.fullName, relationship: g?.relationship ?? "SELF", enrolments: s.enrolments.filter((e) => !g?.blockedInstitutionIds.includes(e.institution.id)) };
  }));
}));

const scope = async (req: any, res: any) => {
  const access = await childAccess(req.user, req.params.sid);
  const institutionId = z.string().uuid().safeParse(req.query.institutionId);
  if (!access || !institutionId.success || access.blocked.has(institutionId.data)) { res.status(404).json({ error: "not_found" }); return null; }
  const en = await prisma.enrolment.findFirst({ where: { studentId: access.studentId, institutionId: institutionId.data, status: "ACTIVE" }, include: { class: true }, orderBy: { joinedAt: "desc" } });
  if (!en) { res.status(404).json({ error: "not_found" }); return null; }
  return { access, en, institutionId: institutionId.data };
};

// Published results by subject and term, with the teacher's personal feedback.
schoolFamily.get("/children/:sid/progress", h(async (req, res) => {
  const s = await scope(req, res);
  if (!s) return;
  if (!s.access.canViewProgress) return res.status(403).json({ error: "forbidden" });
  const year = typeof req.query.year === "string" ? req.query.year : s.en.academicYear;
  const grades = await prisma.grade.findMany({
    where: { enrolment: { studentId: s.access.studentId, institutionId: s.institutionId, academicYear: year }, assessment: { publishedAt: { not: null } } },
    select: { score: true, feedback: true, assessment: { select: { id: true, title: true, type: true, date: true, maxScore: true, termNo: true, publishedAt: true, subject: { select: { name: true } }, class: { select: { level: true } } } } },
    orderBy: { assessment: { date: "asc" } },
  });
  const bySubject = new Map<string, any>();
  for (const g of grades) {
    const a = g.assessment, subj = a.subject.name;
    const item = { id: a.id, title: a.title, type: a.type, date: a.date, termNo: a.termNo, score: g.score, maxScore: a.maxScore, percent: g.score == null ? null : percentOf(g.score, a.maxScore), grade: g.score == null ? null : gradeFor(percentOf(g.score, a.maxScore), a.class.level), feedback: g.feedback };
    (bySubject.get(subj) ?? bySubject.set(subj, { subject: subj, items: [] }).get(subj)).items.push(item);
  }
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const subjects = [...bySubject.values()].map((x) => {
    const pcts = x.items.map((i: any) => i.percent).filter((p: number | null): p is number => p != null);
    const a = avg(pcts);
    return { ...x, average: a, grade: a == null ? null : gradeFor(a, s.en.class?.level) };
  });
  const all = subjects.map((x) => x.average).filter((x): x is number => x != null);
  res.json({ academicYear: year, class: s.en.class?.name ?? null, level: s.en.class?.level ?? null, subjects, overallAverage: avg(all) });
}));

schoolFamily.get("/children/:sid/attendance", h(async (req, res) => {
  const s = await scope(req, res);
  if (!s) return;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? new Date(`${req.query.to}T00:00:00Z`) : new Date();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? new Date(`${req.query.from}T00:00:00Z`) : new Date(to.getTime() - 60 * 864e5);
  const records = await prisma.attendance.findMany({ where: { enrolmentId: s.en.id, date: { gte: from, lte: to } }, select: { date: true, status: true, note: true }, orderBy: { date: "desc" }, take: 400 });
  const count = (st: string) => records.filter((r) => r.status === st).length;
  const marked = records.length;
  res.json({ records, summary: { marked, present: count("PRESENT"), absent: count("ABSENT"), late: count("LATE"), excused: count("EXCUSED"), rate: marked ? Math.round(((count("PRESENT") + count("LATE") + count("EXCUSED")) / marked) * 100) : null } });
}));

// Notices of the child's school: whole-school ones and those for the child's class.
schoolFamily.get("/children/:sid/announcements", h(async (req, res) => {
  const s = await scope(req, res);
  if (!s) return;
  const rows = await prisma.announcement.findMany({
    where: { institutionId: s.institutionId, OR: [{ audience: "SCHOOL" }, ...(s.en.classId ? [{ classIds: { has: s.en.classId } }] : [])] },
    select: { id: true, title: true, body: true, urgent: true, createdAt: true, reads: { where: { userId: req.user!.sub }, select: { readAt: true } } },
    orderBy: { createdAt: "desc" }, take: 50,
  });
  res.json(rows.map(({ reads, ...a }) => ({ ...a, read: reads.length > 0 })));
}));

schoolFamily.post("/announcements/:id/read", h(async (req, res) => {
  // only announcements this person could see: they must be linked to a child of that school
  const a = await prisma.announcement.findUnique({ where: { id: req.params.id } });
  if (!a) return res.status(404).json({ error: "not_found" });
  const link = req.user!.role === "PARENT"
    ? await prisma.guardianship.findFirst({ where: { guardianUserId: req.user!.sub, status: "ACTIVE", NOT: { blockedInstitutionIds: { has: a.institutionId } }, student: { enrolments: { some: { institutionId: a.institutionId, status: "ACTIVE" } } } } })
    : await prisma.student.findFirst({ where: { userId: req.user!.sub, enrolments: { some: { institutionId: a.institutionId, status: "ACTIVE" } } } });
  if (!link) return res.status(404).json({ error: "not_found" });
  await prisma.announcementRead.upsert({ where: { announcementId_userId: { announcementId: a.id, userId: req.user!.sub } }, create: { announcementId: a.id, userId: req.user!.sub }, update: {} });
  res.status(204).end();
}));
