import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { body, h } from "../middleware/validate.js";
import { presignDownload, presignUpload } from "../lib/storage.js";
import { canActForStudent } from "../lib/access.js";
import { splitFee } from "../lib/money.js";
import { normalisePhone } from "../lib/phone.js";
import { reconcile } from "../lib/reconcile.js";
import { REFERENCE_RE, normaliseReference } from "../lib/reference.js";
import { Prisma } from "@prisma/client";

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
  res.status(201).json(await prisma.student.create({ data: { ...req.body, parentId: p.id } }));
}));

family.get("/children", requireRole("PARENT"), h(async (req, res) => {
  res.json(await prisma.student.findMany({ where: { parent: { userId: req.user!.sub } } }));
}));

// ---- Credentials (student, or parent on behalf of a child)
const fileMeta = z.object({ mime: z.string(), size: z.number().int().positive() });
family.post("/students/:sid/credentials/upload-url", body(fileMeta), h(async (req, res) => {
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

// ---- Applications
family.post("/applications", body(z.object({
  studentId: z.string().uuid(), programId: z.string().uuid(), statement: z.string().max(3000).optional(),
  credentialIds: z.array(z.string().uuid()).max(20).default([]), clientId: z.string().uuid().optional(),
})), h(async (req, res) => {
  const b = req.body;
  const student = await canActForStudent(req.user!, b.studentId);
  if (!student) return res.status(404).json({ error: "not_found" });
  const program = await prisma.program.findUnique({ where: { id: b.programId }, include: { institution: true } });
  const now = new Date();
  if (!program || program.status !== "ACTIVE" || program.institution.status !== "VERIFIED" || (program.closesAt && program.closesAt < now) || program.seatsTaken >= program.seats)
    return res.status(409).json({ error: "program_not_open" });

  const creds = await prisma.credential.findMany({ where: { id: { in: b.credentialIds }, studentId: student.id } });
  if (creds.length !== b.credentialIds.length) return res.status(400).json({ error: "bad_credentials" });
  if (["PRIMARY_SCHOOL", "SECONDARY_SCHOOL"].includes(program.institution.type)) {
    const hasReport = creds.some((c) => c.kind === "SCHOOL_REPORT") ||
      (await prisma.gradeRequest.count({ where: { studentId: student.id, status: { in: ["PENDING", "FULFILLED"] } } })) > 0;
    if (!hasReport) return res.status(422).json({ error: "school_report_required" });
  }

  const cfg = await prisma.revenueConfig.findFirstOrThrow({ where: { effectiveFrom: { lte: now } }, orderBy: { effectiveFrom: "desc" } });
  const s = splitFee(program.applicationFee, cfg.institutionCommissionBps, cfg.studentServiceFeeBps);
  try {
    const app = await prisma.application.create({ data: {
      studentId: student.id, programId: program.id, statement: b.statement, clientId: b.clientId,
      attachedCredentialIds: b.credentialIds, status: "AWAITING_PAYMENT",
      feeMinor: s.feeMinor, studentServiceFeeMinor: s.studentServiceFeeMinor, commissionMinor: s.commissionMinor, totalDueMinor: s.totalDueMinor,
    } });
    res.status(201).json(app);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await prisma.application.findFirst({ where: { OR: [{ clientId: b.clientId ?? "" }, { studentId: student.id, programId: program.id }] } });
      return res.status(200).json(existing); // idempotent replay from the offline outbox
    }
    throw e;
  }
}));

family.post("/applications/:id/payment", body(z.object({
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
const mine = (req: any) => (req.user.role === "PARENT" ? { parent: { userId: req.user.sub } } : { userId: req.user.sub });

family.get("/applications", h(async (req, res) => {
  res.json(await prisma.application.findMany({
    where: { student: mine(req) },
    select: { id: true, status: true, totalDueMinor: true, feeMinor: true, studentServiceFeeMinor: true, decisionNote: true, createdAt: true, updatedAt: true,
      student: { select: { id: true, fullName: true } }, program: { select: { id: true, title: true, institution: { select: { name: true } } } },
      payments: { select: { provider: true, reference: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 }, letter: { select: { id: true } } },
    orderBy: { updatedAt: "desc" }, take: 100,
  }));
}));

family.get("/applications/:id/letter", h(async (req, res) => {
  const a = await prisma.application.findFirst({ where: { id: req.params.id, student: mine(req) }, include: { letter: true } });
  if (!a?.letter) return res.status(404).json({ error: "not_found" });
  res.json({ url: await presignDownload(a.letter.storageKey, 120) });
}));

family.get("/students/:sid/credentials", h(async (req, res) => {
  if (!(await canActForStudent(req.user!, req.params.sid!))) return res.status(404).json({ error: "not_found" });
  res.json(await prisma.credential.findMany({ where: { studentId: req.params.sid }, select: { id: true, kind: true, title: true, mime: true, createdAt: true }, orderBy: { createdAt: "desc" } }));
}));

family.delete("/applications/:id", h(async (req, res) => {
  const a = await prisma.application.findFirst({ where: { id: req.params.id, student: mine(req), status: { in: ["AWAITING_PAYMENT"] } } });
  if (!a) return res.status(409).json({ error: "cannot_withdraw" });
  await prisma.application.update({ where: { id: a.id }, data: { status: "WITHDRAWN" } });
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
