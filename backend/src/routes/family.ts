import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireRole, requireVerifiedPhone } from "../middleware/auth.js";
import { maskHeld } from "../lib/decisions.js";
import { body, h } from "../middleware/validate.js";
import { presignDownload, presignUpload } from "../lib/storage.js";
import { canActForStudent } from "../lib/access.js";
import { splitFee } from "../lib/money.js";
import { normalisePhone } from "../lib/phone.js";
import { reconcile } from "../lib/reconcile.js";
import { REFERENCE_RE, normaliseReference } from "../lib/reference.js";
import { Prisma } from "@prisma/client";
import { config } from "../config.js";
import { isSchool, MAX_CHOICES_TERTIARY } from "../lib/levels.js";
import { SECTIONS, academicDocKinds, personal, validateForSubmit, type Missing, type SectionName } from "../lib/applicationForm.js";

export const family = Router();
family.use(authenticate, requireRole("PARENT", "STUDENT"));

// ---- Parent: register children, occupation
family.put("/parent/profile", requireRole("PARENT"), body(z.object({ occupation: z.string().min(2), employer: z.string().optional() })), h(async (req, res) => {
  res.json(await prisma.parentProfile.update({ where: { userId: req.user!.sub }, data: req.body }));
}));

family.post("/children", requireRole("PARENT"), body(z.object({
  fullName: z.string().min(2), dateOfBirth: z.coerce.date(), gender: z.string().optional(),
  currentSchoolId: z.string().uuid().optional(), currentSchoolName: z.string().optional(),
})), h(async (req, res) => {
  const p = await prisma.parentProfile.findUniqueOrThrow({ where: { userId: req.user!.sub } });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub }, select: { phone: true, fullName: true } });
  const child = await prisma.student.create({ data: { ...req.body, parentId: p.id } });
  // School Hub: the parent is also an ACTIVE guardian of the child (several guardians per child are possible)
  if (me.phone) await prisma.guardianship.create({ data: { studentId: child.id, guardianUserId: req.user!.sub, phone: me.phone, fullName: me.fullName, relationship: "PARENT", isPrimary: true, source: "ADMISSIONS" } });
  res.status(201).json(child);
}));

family.get("/children", requireRole("PARENT"), h(async (req, res) => {
  res.json(await prisma.student.findMany({ where: { parent: { userId: req.user!.sub } } }));
}));

// ---- Credentials (student, or parent on behalf of a child)
const fileMeta = z.object({ mime: z.string(), size: z.number().int().positive() });
family.post("/students/:sid/credentials/upload-url", requireVerifiedPhone, body(fileMeta), h(async (req, res) => {
  if (!(await canActForStudent(req.user!, req.params.sid!))) return res.status(404).json({ error: "not_found" });
  res.json(await presignUpload(`students/${req.params.sid}/creds`, req.body.mime, req.body.size));
}));

family.post("/students/:sid/credentials", body(fileMeta.extend({ key: z.string(), sha256: z.string().length(64), kind: z.string(), title: z.string().max(120) })), h(async (req, res) => {
  if (!(await canActForStudent(req.user!, req.params.sid!)) || !req.body.key.startsWith(`students/${req.params.sid}/creds/`)) return res.status(404).json({ error: "not_found" });
  res.status(201).json(await prisma.credential.create({ data: { studentId: req.params.sid!, kind: req.body.kind, title: req.body.title, storageKey: req.body.key, sha256: req.body.sha256, mime: req.body.mime } }));
}));

family.get("/credentials/:id/download", h(async (req, res) => {
  const c = await prisma.credential.findUnique({ where: { id: req.params.id } });
  if (!c || !(await canActForStudent(req.user!, c.studentId))) return res.status(404).json({ error: "not_found" });
  res.json({ url: await presignDownload(c.storageKey) });
}));

// ---- Grades from a school registered on the platform
family.post("/students/:sid/grade-requests", body(z.object({ fromSchoolId: z.string().uuid(), toSchoolId: z.string().uuid().optional() })), h(async (req, res) => {
  if (!(await canActForStudent(req.user!, req.params.sid!))) return res.status(404).json({ error: "not_found" });
  const from = await prisma.institution.findFirst({ where: { id: req.body.fromSchoolId, status: "VERIFIED" } });
  if (!from) return res.status(400).json({ error: "school_not_on_platform" });
  res.status(201).json(await prisma.gradeRequest.create({ data: { studentId: req.params.sid!, ...req.body } }));
}));

// ---- Applications: a resumable multi-step draft. Steps are saved as the applicant goes; submit validates everything.
const FEE_SELECT = { applicationFee: true } as const;
const MAX_TERTIARY = MAX_CHOICES_TERTIARY;

// One application fee per application: the highest fee among the chosen programmes (so rank order cannot be used to dodge it).
async function snapshotFees(programIds: string[]) {
  const programs = await prisma.program.findMany({ where: { id: { in: programIds } }, select: FEE_SELECT });
  const cfg = await prisma.revenueConfig.findFirstOrThrow({ where: { effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: "desc" } });
  const s = splitFee(Math.max(0, ...programs.map((p) => p.applicationFee)), cfg.institutionCommissionBps, cfg.studentServiceFeeBps);
  return { feeMinor: s.feeMinor, studentServiceFeeMinor: s.studentServiceFeeMinor, commissionMinor: s.commissionMinor, totalDueMinor: s.totalDueMinor };
}

const isOpen = (p: { status: string; closesAt: Date | null; seatsTaken: number; seats: number; institution: { status: string } }) =>
  p.status === "ACTIVE" && p.institution.status === "VERIFIED" && !(p.closesAt && p.closesAt < new Date()) && p.seatsTaken < p.seats;

const myDraft = async (req: any, id: string) => {
  const a = await prisma.application.findUnique({ where: { id }, include: { institution: true, choices: { include: { program: true }, orderBy: { rank: "asc" } } } });
  if (!a || !(await canActForStudent(req.user!, a.studentId))) return null;
  return a;
};

family.post("/applications/draft", requireVerifiedPhone, body(z.object({ studentId: z.string().uuid(), programId: z.string().uuid(), clientId: z.string().uuid().optional() })), h(async (req, res) => {
  const student = await canActForStudent(req.user!, req.body.studentId);
  if (!student) return res.status(404).json({ error: "not_found" });
  const program = await prisma.program.findUnique({ where: { id: req.body.programId }, include: { institution: true } });
  if (!program || !isOpen(program)) return res.status(409).json({ error: "program_not_open" });
  const year = config.ACADEMIC_YEAR;
  const existing = await prisma.application.findUnique({ where: { studentId_institutionId_academicYear: { studentId: student.id, institutionId: program.institutionId, academicYear: year } } });
  if (existing) return ["DRAFT", "AWAITING_PAYMENT"].includes(existing.status) ? res.status(200).json(existing) : res.status(409).json({ error: "already_applied" });
  const fees = await snapshotFees([program.id]);
  try {
    const a = await prisma.application.create({ data: { studentId: student.id, institutionId: program.institutionId, academicYear: year, programId: program.id, clientId: req.body.clientId, status: "DRAFT", ...fees, choices: { create: [{ programId: program.id, rank: 1 }] } } });
    res.status(201).json(a);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return res.status(200).json(await prisma.application.findFirst({ where: { OR: [{ clientId: req.body.clientId ?? "" }, { studentId: student.id, institutionId: program.institutionId, academicYear: year }] } }));
    throw e;
  }
}));

// Everything the wizard needs to open (or resume) an application.
family.get("/applications/:id", h(async (req, res) => {
  const a = await myDraft(req, req.params.id!);
  if (!a) return res.status(404).json({ error: "not_found" });
  const student = await prisma.student.findUniqueOrThrow({ where: { id: a.studentId }, include: { parent: { select: { occupation: true, employer: true, user: { select: { fullName: true, phone: true, email: true } } } } } });
  const { institution: i, choices, ...app } = maskHeld(a as any) as typeof a;
  res.json({ ...app, institution: { id: i.id, name: i.name, type: i.type, campuses: i.campuses, highestLevel: i.highestLevel, syllabi: i.syllabi },
    choices: choices.map((c) => ({ rank: c.rank, program: { id: c.program.id, title: c.program.title, level: c.program.level, classLevel: c.program.classLevel, syllabus: c.program.syllabus, modes: c.program.modes, tuitionFeeMinor: c.program.tuitionFeeMinor, tuitionPeriod: c.program.tuitionPeriod, duration: c.program.duration, applicationFee: c.program.applicationFee } })),
    student: { id: student.id, fullName: student.fullName, dateOfBirth: student.dateOfBirth, profile: student.profile, parent: student.parent },
    maxChoices: isSchool(i.type) ? 1 : MAX_TERTIARY });
}));

// Save one step. `?partial=1` stores a half-finished step (Save & exit); otherwise the step must be valid.
family.put("/applications/:id/section/:name", h(async (req, res) => {
  const a = await myDraft(req, req.params.id!);
  if (!a || a.status !== "DRAFT") return res.status(a ? 409 : 404).json({ error: a ? "not_editable" : "not_found" });
  const name = req.params.name as SectionName;
  const schema = SECTIONS[name];
  if (!schema) return res.status(404).json({ error: "not_found" });
  const partial = req.query.partial === "1";
  // Nobody is asked for a phone number twice: the applicant's own number is the one they signed up (and verified) with,
  // and a parent applying for a child is the guardian. (Filled in BEFORE validation.)
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub }, select: { phone: true, role: true } });
  const input = { ...req.body };
  if (me.phone && name === "personal") input.phone = me.phone;
  if (me.phone && name === "guardian" && me.role === "PARENT") input.phone = me.phone;
  const parsed = partial ? (schema as any).partial().safeParse(input) : schema.safeParse(input);
  if (!parsed.success) return res.status(400).json({ error: "validation", issues: parsed.error.issues });
  const data = JSON.parse(JSON.stringify(parsed.data)); // dates -> ISO strings for the JSON column
  if (name === "payment" && data.payerPhone) { const np = normalisePhone(data.payerPhone); if (!np) return res.status(400).json({ error: "invalid_phone" }); data.payerPhone = np; }
  const form = { ...(a.form as object), [name]: data };
  await prisma.application.update({ where: { id: a.id }, data: { form } });
  if (name === "personal" && !partial) { // bio data is entered once and reused for every later application
    const d = parsed.data as z.infer<typeof personal>;
    await prisma.student.update({ where: { id: a.studentId }, data: { profile: data, fullName: [d.firstName, d.middleName, d.surname].filter(Boolean).join(" "), dateOfBirth: d.dateOfBirth, gender: d.gender } });
  }
  res.json({ ok: true });
}));

family.put("/applications/:id/statement", body(z.object({ statement: z.string().max(3000) })), h(async (req, res) => {
  const a = await myDraft(req, req.params.id!);
  if (!a || a.status !== "DRAFT") return res.status(a ? 409 : 404).json({ error: a ? "not_editable" : "not_found" });
  await prisma.application.update({ where: { id: a.id }, data: { statement: req.body.statement } });
  res.json({ ok: true });
}));

// Ranked choices. Colleges/universities: 1-3 programmes of THIS institution. Schools: exactly one class level.
family.put("/applications/:id/choices", body(z.object({ programIds: z.array(z.string().uuid()).min(1).max(MAX_TERTIARY) })), h(async (req, res) => {
  const a = await myDraft(req, req.params.id!);
  if (!a || a.status !== "DRAFT") return res.status(a ? 409 : 404).json({ error: a ? "not_editable" : "not_found" });
  const ids: string[] = req.body.programIds;
  if (new Set(ids).size !== ids.length) return res.status(400).json({ error: "duplicate_choice" });
  const max = isSchool(a.institution.type) ? 1 : MAX_TERTIARY;
  if (ids.length > max) return res.status(422).json({ error: "too_many_choices", max });
  const programs = await prisma.program.findMany({ where: { id: { in: ids } }, include: { institution: true } });
  if (programs.length !== ids.length || programs.some((p) => p.institutionId !== a.institutionId)) return res.status(422).json({ error: "choices_must_be_one_institution" });
  if (programs.some((p) => !isOpen(p))) return res.status(409).json({ error: "program_not_open" });
  const fees = await snapshotFees(ids);
  await prisma.$transaction([
    prisma.applicationChoice.deleteMany({ where: { applicationId: a.id } }),
    prisma.applicationChoice.createMany({ data: ids.map((programId, i) => ({ applicationId: a.id, programId, rank: i + 1 })) }),
    prisma.application.update({ where: { id: a.id }, data: { programId: ids[0]!, ...fees } }),
  ]);
  res.json({ ok: true, ...fees });
}));

family.put("/applications/:id/documents", body(z.object({ credentialIds: z.array(z.string().uuid()).max(20) })), h(async (req, res) => {
  const a = await myDraft(req, req.params.id!);
  if (!a || a.status !== "DRAFT") return res.status(a ? 409 : 404).json({ error: a ? "not_editable" : "not_found" });
  const creds = await prisma.credential.count({ where: { id: { in: req.body.credentialIds }, studentId: a.studentId } });
  if (creds !== req.body.credentialIds.length) return res.status(400).json({ error: "bad_credentials" });
  await prisma.application.update({ where: { id: a.id }, data: { attachedCredentialIds: req.body.credentialIds } });
  res.json({ ok: true });
}));

family.post("/applications/:id/submit", requireVerifiedPhone, h(async (req, res) => {
  const a = await myDraft(req, req.params.id!);
  if (!a || a.status !== "DRAFT") return res.status(a ? 409 : 404).json({ error: a ? "not_editable" : "not_found" });
  const inst = a.institution, form = JSON.parse(JSON.stringify(a.form)) as Record<string, any>;
  const first = a.choices[0]?.program;
  if (!first) return res.status(422).json({ error: "incomplete", missing: [{ section: "choices", step: "programmes", message: "choices" }] });
  // drafts started before phone numbers stopped being asked: fill them from the account
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub }, select: { phone: true, role: true } });
  if (me.phone && form.personal && !form.personal.phone) form.personal.phone = me.phone;
  if (me.phone && form.guardian && me.role === "PARENT" && !form.guardian.phone) form.guardian.phone = me.phone;
  const student = await prisma.student.findUniqueOrThrow({ where: { id: a.studentId } });
  const age = Math.floor((Date.now() - student.dateOfBirth.getTime()) / 31_557_600_000);
  const missing: Missing[] = validateForSubmit(inst.type, form, { age, isStandardOneEntry: isSchool(inst.type) && first.classLevel === "STD1" });
  const payerPhone = form.payment?.payerPhone ? normalisePhone(form.payment.payerPhone) : null;
  if (form.payment && !payerPhone && !missing.some((m) => m.section === "payment")) missing.push({ section: "payment", step: "payment", message: "payerPhone" });

  // study mode / campus must be one the chosen programmes and institution actually offer
  if (!isSchool(inst.type)) {
    const offered = [...new Set(a.choices.flatMap((c) => c.program.modes))];
    if (offered.length && !offered.includes(form.study?.mode)) missing.push({ section: "study", step: "study", message: "mode" });
    if (inst.campuses.length && !inst.campuses.includes(form.study?.campus)) missing.push({ section: "study", step: "study", message: "campus" });
  }
  // documents: national ID + an academic record (colleges/universities); report or grades request (schools, unless Standard 1)
  const attached = await prisma.credential.findMany({ where: { id: { in: a.attachedCredentialIds }, studentId: a.studentId }, select: { kind: true } });
  const kinds = new Set(attached.map((c) => c.kind));
  const wantsGrades = !!(form.education?.requestGrades && form.education?.previousSchoolId);
  if (isSchool(inst.type)) {
    if (first.classLevel !== "STD1" && !academicDocKinds.some((k) => kinds.has(k)) && !wantsGrades) missing.push({ section: "documents", step: "documents", message: "school_report" });
  } else {
    if (!academicDocKinds.some((k) => kinds.has(k)) && !wantsGrades) missing.push({ section: "documents", step: "documents", message: "academic" });
    if (!kinds.has("ID")) missing.push({ section: "documents", step: "documents", message: "id" });
  }
  if (missing.length) return res.status(422).json({ error: "incomplete", missing });

  // Submit and record the payment together: if the transaction ID was already used by someone else, nothing is submitted.
  const fees = await snapshotFees(a.choices.map((c) => c.programId));
  const reference = normaliseReference(form.payment.reference);
  let done;
  try {
    [, done] = await prisma.$transaction([
      prisma.payment.create({ data: { applicationId: a.id, provider: form.payment.provider, reference, payerPhone: payerPhone!, amountMinor: fees.totalDueMinor } }),
      prisma.application.update({ where: { id: a.id }, data: { status: "PAYMENT_SUBMITTED", submittedAt: new Date(), form, ...fees } }),
    ]);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return res.status(409).json({ error: "reference_already_used", step: "payment" });
    throw e;
  }
  if (wantsGrades) { // replaces the old standalone "ask my previous school" button
    const from = await prisma.institution.findFirst({ where: { id: form.education.previousSchoolId, status: "VERIFIED" } });
    if (from && !(await prisma.gradeRequest.count({ where: { studentId: a.studentId, fromSchoolId: from.id, status: { in: ["PENDING", "FULFILLED"] } } })))
      await prisma.gradeRequest.create({ data: { studentId: a.studentId, fromSchoolId: from.id, toSchoolId: inst.id } });
  }
  await reconcile(form.payment.provider, [reference]); // instant confirm if the SMS already arrived
  res.json(await prisma.application.findUniqueOrThrow({ where: { id: a.id } }));
}));

family.post("/applications/:id/payment", requireVerifiedPhone, body(z.object({
  provider: z.enum(["AIRTEL_MONEY", "MPAMBA"]), reference: z.string().trim().min(6).max(30).regex(REFERENCE_RE), payerPhone: z.string(),
})), h(async (req, res) => {
  const app = await prisma.application.findUnique({ where: { id: req.params.id } });
  if (!app || !(await canActForStudent(req.user!, app.studentId))) return res.status(404).json({ error: "not_found" });
  if (app.status !== "AWAITING_PAYMENT") return res.status(409).json({ error: "not_awaiting_payment" });
  const phone = normalisePhone(req.body.payerPhone);
  if (!phone) return res.status(400).json({ error: "invalid_phone" });
  const reference = normaliseReference(req.body.reference);
  try {
    await prisma.$transaction([
      prisma.payment.create({ data: { applicationId: app.id, provider: req.body.provider, reference, payerPhone: phone, amountMinor: app.totalDueMinor } }),
      prisma.application.update({ where: { id: app.id }, data: { status: "PAYMENT_SUBMITTED" } }),
    ]);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return res.status(409).json({ error: "reference_already_used" });
    throw e;
  }
  await reconcile(req.body.provider, [reference]); // instant confirm if the SMS already arrived
  res.status(202).json({ status: "PAYMENT_SUBMITTED", message: "Payment received for verification. You will receive a confirmation once your payment is confirmed." });
}));

// ---- Read endpoints for the web app (the mobile app gets the same data through /sync/pull)
// a parent acts for their own children AND for children a school linked them to as guardians
const mine = (req: any) => (req.user.role === "PARENT" ? { OR: [{ parent: { userId: req.user.sub } }, { guardianships: { some: { guardianUserId: req.user.sub, status: "ACTIVE", relationship: { in: ["PARENT", "GUARDIAN"] } } } }] } : { userId: req.user.sub });

family.get("/applications", h(async (req, res) => {
  res.json((await prisma.application.findMany({
    where: { student: mine(req) },
    select: { id: true, status: true, totalDueMinor: true, feeMinor: true, studentServiceFeeMinor: true, decisionNote: true, decidedAt: true, decisionPublishedAt: true, createdAt: true, updatedAt: true,
      student: { select: { id: true, fullName: true } }, program: { select: { id: true, title: true, institution: { select: { name: true } } } },
      payments: { select: { provider: true, reference: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 }, letter: { select: { id: true } } },
    orderBy: { updatedAt: "desc" }, take: 100,
  })).map(maskHeld)); // a decision the school is still holding is invisible to the applicant
}));

family.get("/applications/:id/letter", h(async (req, res) => {
  const a = await prisma.application.findFirst({ where: { id: req.params.id, student: mine(req) }, include: { letter: true } });
  if (!a?.letter || (a.decidedAt && !a.decisionPublishedAt)) return res.status(404).json({ error: "not_found" });
  res.json({ url: await presignDownload(a.letter.storageKey, 120) });
}));

family.get("/students/:sid/credentials", h(async (req, res) => {
  if (!(await canActForStudent(req.user!, req.params.sid!))) return res.status(404).json({ error: "not_found" });
  res.json(await prisma.credential.findMany({ where: { studentId: req.params.sid }, select: { id: true, kind: true, title: true, mime: true, createdAt: true }, orderBy: { createdAt: "desc" } }));
}));

family.delete("/applications/:id", h(async (req, res) => {
  const a = await prisma.application.findFirst({ where: { id: req.params.id, student: mine(req), status: { in: ["DRAFT", "AWAITING_PAYMENT"] } }, include: { _count: { select: { payments: true } } } });
  if (!a) return res.status(409).json({ error: "cannot_withdraw" });
  // Nothing was paid: remove it entirely so the applicant can start again. Otherwise keep the record as WITHDRAWN.
  if (a._count.payments === 0) await prisma.application.delete({ where: { id: a.id } });
  else await prisma.application.update({ where: { id: a.id }, data: { status: "WITHDRAWN" } });
  res.status(204).end();
}));

// Students this user can act for: a parent's children, or the student themself.
family.get("/students", h(async (req, res) => {
  res.json(await prisma.student.findMany({ where: mine(req), orderBy: { createdAt: "asc" } }));
}));

family.patch("/students/:sid", body(z.object({
  dateOfBirth: z.coerce.date().optional(), gender: z.enum(["M", "F"]).optional(),
  currentSchoolId: z.string().uuid().nullable().optional(), currentSchoolName: z.string().max(120).optional(),
}).strict()), h(async (req, res) => {
  if (!(await canActForStudent(req.user!, req.params.sid!))) return res.status(404).json({ error: "not_found" });
  res.json(await prisma.student.update({ where: { id: req.params.sid }, data: req.body }));
}));
