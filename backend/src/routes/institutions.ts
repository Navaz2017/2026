import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireMfa, requireRole } from "../middleware/auth.js";
import { body, h } from "../middleware/validate.js";
import { presignDownload, presignUpload } from "../lib/storage.js";
import { normalisePhone } from "../lib/phone.js";
import { DEFAULT_TEMPLATES, renderLetter } from "../lib/letters.js";
import { enqueueLetter } from "../jobs/queue.js";
import { applicantUserIds, notifyUsers } from "../lib/notify.js";
import { audit } from "../lib/audit.js";

export const institutions = Router();
institutions.use(authenticate, requireRole("INSTITUTION_ADMIN"));

// Every handler is scoped to req.user.inst — an admin can never name another institution's id.
const inst = (req: any) => req.user!.inst as string;

institutions.get("/me", h(async (req, res) => {
  res.json(await prisma.institution.findUnique({ where: { id: inst(req) }, include: { documents: true } }));
}));

institutions.patch("/me", body(z.object({
  address: z.string().optional(), contactPhone: z.string().optional(),
  payoutProvider: z.enum(["AIRTEL_MONEY", "MPAMBA"]).optional(), payoutPhone: z.string().optional(),
}).strict()), h(async (req, res) => {
  const phone = req.body.payoutPhone ? normalisePhone(req.body.payoutPhone) : undefined;
  if (req.body.payoutPhone && !phone) return res.status(400).json({ error: "invalid_phone" });
  res.json(await prisma.institution.update({ where: { id: inst(req) }, data: { ...req.body, ...(phone && { payoutPhone: phone }) } }));
}));

// Step 1: ask for an upload slot. Step 2: client PUTs the file to S3. Step 3: client confirms (below).
const fileMeta = z.object({ mime: z.string(), size: z.number().int().positive(), kind: z.string().max(40) });
institutions.post("/me/documents/upload-url", body(fileMeta), h(async (req, res) => {
  res.json(await presignUpload(`inst/${inst(req)}/docs`, req.body.mime, req.body.size));
}));

institutions.post("/me/documents", body(fileMeta.extend({ key: z.string(), sha256: z.string().length(64) })), h(async (req, res) => {
  if (!req.body.key.startsWith(`inst/${inst(req)}/docs/`)) return res.status(400).json({ error: "bad_key" });
  const doc = await prisma.institutionDocument.create({ data: { institutionId: inst(req), kind: req.body.kind, storageKey: req.body.key, sha256: req.body.sha256, mime: req.body.mime } });
  // First document moves the institution into the owner's review queue.
  await prisma.institution.updateMany({ where: { id: inst(req), status: "PENDING" }, data: { status: "UNDER_REVIEW" } });
  res.status(201).json(doc);
}));

// Programs may be created before verification; they stay PENDING_VERIFICATION until the owner verifies.
const programBody = z.object({
  title: z.string().min(2), level: z.string(), description: z.string().optional(), seats: z.number().int().min(1),
  applicationFee: z.number().int().min(0), opensAt: z.coerce.date().optional(), closesAt: z.coerce.date().optional(),
});

institutions.get("/programs", h(async (req, res) => {
  res.json(await prisma.program.findMany({ where: { institutionId: inst(req) }, orderBy: { updatedAt: "desc" } }));
}));

institutions.post("/programs", body(programBody), h(async (req, res) => {
  const i = await prisma.institution.findUniqueOrThrow({ where: { id: inst(req) } });
  const status = i.status === "VERIFIED" ? "ACTIVE" : "PENDING_VERIFICATION";
  res.status(201).json(await prisma.program.create({ data: { ...req.body, institutionId: i.id, status } }));
}));

institutions.patch("/programs/:id", body(programBody.partial().extend({ status: z.enum(["CLOSED"]).optional() }).strict()), h(async (req, res) => {
  const r = await prisma.program.updateMany({ where: { id: req.params.id, institutionId: inst(req) }, data: req.body });
  r.count ? res.json({ ok: true }) : res.status(404).json({ error: "not_found" });
}));

institutions.post("/media/upload-url", body(z.object({ mime: z.string(), size: z.number().int().positive() })), h(async (req, res) => {
  res.json(await presignUpload(`inst/${inst(req)}/media`, req.body.mime, req.body.size));
}));

institutions.post("/media", body(z.object({ key: z.string(), kind: z.enum(["IMAGE", "VIDEO"]), caption: z.string().max(200).optional() })), h(async (req, res) => {
  if (!req.body.key.startsWith(`inst/${inst(req)}/media/`)) return res.status(400).json({ error: "bad_key" });
  res.status(201).json(await prisma.media.create({ data: { institutionId: inst(req), kind: req.body.kind, caption: req.body.caption, storageKey: req.body.key, approved: false } }));
}));

institutions.get("/media", h(async (req, res) => {
  const rows = await prisma.media.findMany({ where: { institutionId: inst(req) }, orderBy: { createdAt: "desc" } });
  res.json(await Promise.all(rows.map(async (m) => ({ id: m.id, kind: m.kind, caption: m.caption, approved: m.approved, url: await presignDownload(m.storageKey, 300) }))));
}));

institutions.delete("/media/:id", h(async (req, res) => {
  const r = await prisma.media.deleteMany({ where: { id: req.params.id, institutionId: inst(req) } });
  r.count ? res.status(204).end() : res.status(404).json({ error: "not_found" });
}));

// Letter templates (acceptance / rejection) customised by the institution.
institutions.put("/letter-templates/:kind", body(z.object({ body: z.string().min(20).max(10_000), signatory: z.string().max(120).optional() })), h(async (req, res) => {
  const kind = z.enum(["ACCEPTANCE", "REJECTION"]).parse(req.params.kind);
  res.json(await prisma.letterTemplate.upsert({
    where: { institutionId_kind: { institutionId: inst(req), kind } },
    create: { institutionId: inst(req), kind, ...req.body }, update: req.body,
  }));
}));

// ---- Overview
institutions.get("/dashboard", h(async (req, res) => {
  const id = inst(req);
  const [i, byStatus, programs, pendingGrades, unsettled, settlements, wa] = await Promise.all([
    prisma.institution.findUniqueOrThrow({ where: { id }, select: { name: true, status: true, reviewNote: true, _count: { select: { documents: true, media: true } } } }),
    prisma.application.groupBy({ by: ["status"], where: { program: { institutionId: id }, status: { notIn: ["DRAFT", "AWAITING_PAYMENT", "PAYMENT_SUBMITTED"] } }, _count: true }),
    prisma.program.findMany({ where: { institutionId: id }, select: { id: true, title: true, status: true, seats: true, seatsTaken: true, applicationFee: true, closesAt: true }, orderBy: { updatedAt: "desc" } }),
    prisma.gradeRequest.count({ where: { fromSchoolId: id, status: "PENDING" } }),
    prisma.application.aggregate({ where: { program: { institutionId: id }, payments: { some: { status: "CONFIRMED", settlementId: null } } }, _sum: { feeMinor: true, commissionMinor: true } }),
    prisma.settlement.findMany({ where: { institutionId: id }, orderBy: { periodStart: "desc" }, take: 12 }),
    prisma.whatsAppSession.findUnique({ where: { institutionId: id }, select: { status: true, phone: true } }),
  ]);
  const u = unsettled._sum;
  res.json({ institution: i, applicationsByStatus: byStatus, programs, pendingGradeRequests: pendingGrades,
    earnings: { pendingNetMinor: (u.feeMinor ?? 0) - (u.commissionMinor ?? 0), settlements }, whatsapp: wa ?? { status: "DISCONNECTED", phone: null } });
}));

// ---- Applications: only paid ones (SUBMITTED and later) are visible to the institution.
const VISIBLE = ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED"] as const;

institutions.get("/applications", h(async (req, res) => {
  const status = z.enum(VISIBLE).optional().parse(req.query.status);
  const programId = z.string().uuid().optional().parse(req.query.programId);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  res.json(await prisma.application.findMany({
    where: { program: { institutionId: inst(req), ...(programId && { id: programId }) }, status: status ?? { in: [...VISIBLE] }, ...(q && { student: { fullName: { contains: q, mode: "insensitive" } } }) },
    select: { id: true, status: true, createdAt: true, updatedAt: true, decidedAt: true, student: { select: { id: true, fullName: true, gender: true, dateOfBirth: true } }, program: { select: { id: true, title: true } } },
    orderBy: { updatedAt: "desc" }, take: 200,
  }));
}));

// Full applicant file: profile, parent occupation, statement, attached credentials (metadata only; files via signed URL below).
institutions.get("/applications/:id", h(async (req, res) => {
  const a = await prisma.application.findFirst({
    where: { id: req.params.id, program: { institutionId: inst(req) }, status: { in: [...VISIBLE] } },
    include: { program: { select: { title: true, level: true, seats: true, seatsTaken: true } }, student: { include: { parent: { select: { occupation: true, employer: true, user: { select: { fullName: true, phone: true, email: true } } } } } } },
  });
  if (!a) return res.status(404).json({ error: "not_found" });
  const fulfilled = await prisma.gradeRequest.findMany({ where: { studentId: a.studentId, status: "FULFILLED", resultCredentialId: { not: null } }, select: { resultCredentialId: true } });
  const ids = [...a.attachedCredentialIds, ...fulfilled.map((g) => g.resultCredentialId!)];
  const credentials = await prisma.credential.findMany({ where: { id: { in: ids }, studentId: a.studentId }, select: { id: true, kind: true, title: true, mime: true, createdAt: true } });
  const { attachedCredentialIds: _x, ...rest } = a;
  res.json({ ...rest, credentials });
}));

// Viewing a child's documents is sensitive: MFA required, short-lived link, always audited.
institutions.get("/applications/:id/credentials/:cid/download", requireMfa, h(async (req, res) => {
  const a = await prisma.application.findFirst({ where: { id: req.params.id, program: { institutionId: inst(req) }, status: { in: [...VISIBLE] } } });
  if (!a) return res.status(404).json({ error: "not_found" });
  const attached = a.attachedCredentialIds.includes(req.params.cid!) ||
    (await prisma.gradeRequest.count({ where: { studentId: a.studentId, status: "FULFILLED", resultCredentialId: req.params.cid } })) > 0;
  const c = attached ? await prisma.credential.findFirst({ where: { id: req.params.cid, studentId: a.studentId } }) : null;
  if (!c) return res.status(404).json({ error: "not_found" });
  await audit(req, "credential.view", "Credential", c.id, { applicationId: a.id });
  res.json({ url: await presignDownload(c.storageKey, 60), mime: c.mime });
}));

institutions.post("/applications/:id/start-review", h(async (req, res) => {
  const r = await prisma.application.updateMany({ where: { id: req.params.id, program: { institutionId: inst(req) }, status: "SUBMITTED" }, data: { status: "UNDER_REVIEW" } });
  res.json({ updated: r.count });
}));

institutions.post("/applications/:id/decision", requireMfa, body(z.object({ decision: z.enum(["ACCEPTED", "REJECTED"]), note: z.string().max(1000).optional() })), h(async (req, res) => {
  const a = await prisma.application.findFirst({ where: { id: req.params.id, program: { institutionId: inst(req) }, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } });
  if (!a) return res.status(404).json({ error: "not_found_or_already_decided" });
  const ok = await prisma.$transaction(async (tx) => {
    // Seat accounting is atomic: two admins accepting the last seat at once cannot both succeed.
    if (req.body.decision === "ACCEPTED") {
      const seat: { count: number } = await tx.$queryRaw`UPDATE "Program" SET "seatsTaken" = "seatsTaken" + 1 WHERE id = ${a.programId} AND "seatsTaken" < seats RETURNING 1 AS count`.then((r: any) => ({ count: r.length }));
      if (!seat.count) return false;
    }
    const r = await tx.application.updateMany({ where: { id: a.id, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } }, data: { status: req.body.decision, decisionNote: req.body.note, decidedAt: new Date() } });
    if (!r.count) throw new Error("concurrent_decision");
    return true;
  });
  if (!ok) return res.status(409).json({ error: "no_seats_left" });
  await audit(req, `application.${req.body.decision}`, "Application", a.id);
  await notifyUsers(await applicantUserIds(a.studentId), `APPLICATION_${req.body.decision}`, "", "", { applicationId: a.id });
  await enqueueLetter(a.id); // PDF + WhatsApp/email delivery; a sweeper retries if the queue is down
  res.json({ ok: true });
}));

// ---- Letter templates
institutions.get("/letter-templates", h(async (req, res) => {
  const rows = await prisma.letterTemplate.findMany({ where: { institutionId: inst(req) } });
  const by = Object.fromEntries(rows.map((r) => [r.kind, r]));
  res.json({ placeholders: ["student.fullName", "program.title", "institution.name", "date", "signatory"], templates: (["ACCEPTANCE", "REJECTION"] as const).map((kind) => ({ kind, body: by[kind]?.body ?? DEFAULT_TEMPLATES[kind], signatory: by[kind]?.signatory ?? "", custom: !!by[kind] })) });
}));

institutions.post("/letter-templates/preview", body(z.object({ body: z.string().max(10_000), signatory: z.string().max(120).optional() })), h(async (req, res) => {
  res.json({ text: renderLetter(req.body.body, { "student.fullName": "Chikondi Banda", "program.title": "Sample Programme", "institution.name": "Your Institution", date: new Date().toISOString().slice(0, 10), signatory: req.body.signatory ?? "" }) });
}));

// ---- WhatsApp linking (whatsapp-web.js runs in the separate wa-worker process; we only exchange state via the DB)
institutions.get("/whatsapp", h(async (req, res) => {
  const s = await prisma.whatsAppSession.findUnique({ where: { institutionId: inst(req) } });
  res.set("Cache-Control", "no-store").json(s ? { desired: s.desired, status: s.status, qr: s.status === "QR" ? s.qr : null, phone: s.phone, lastError: s.lastError } : { desired: false, status: "DISCONNECTED", qr: null, phone: null });
}));

institutions.post("/whatsapp/connect", requireMfa, h(async (req, res) => {
  const i = await prisma.institution.findUniqueOrThrow({ where: { id: inst(req) } });
  if (i.status !== "VERIFIED") return res.status(403).json({ error: "institution_not_verified" });
  await prisma.whatsAppSession.upsert({ where: { institutionId: i.id }, create: { institutionId: i.id, desired: true, status: "STARTING" }, update: { desired: true, status: "STARTING", lastError: null, qr: null } });
  await audit(req, "whatsapp.connect", "Institution", i.id);
  res.status(202).json({ ok: true });
}));

institutions.post("/whatsapp/disconnect", requireMfa, h(async (req, res) => {
  await prisma.whatsAppSession.updateMany({ where: { institutionId: inst(req) }, data: { desired: false } });
  await audit(req, "whatsapp.disconnect", "Institution", inst(req));
  res.status(202).json({ ok: true });
}));

// ---- Grade requests from students transferring FROM this school.
institutions.get("/grade-requests", h(async (req, res) => {
  res.json(await prisma.gradeRequest.findMany({ where: { fromSchoolId: inst(req), status: "PENDING" }, include: { student: { select: { id: true, fullName: true, dateOfBirth: true } } } }));
}));

institutions.post("/grade-requests/:id/upload-url", body(z.object({ mime: z.string(), size: z.number().int().positive() })), h(async (req, res) => {
  const gr = await prisma.gradeRequest.findFirst({ where: { id: req.params.id, fromSchoolId: inst(req), status: "PENDING" } });
  if (!gr) return res.status(404).json({ error: "not_found" });
  res.json(await presignUpload(`students/${gr.studentId}/creds`, req.body.mime, req.body.size));
}));

institutions.post("/grade-requests/:id/fulfil", body(z.object({ key: z.string(), sha256: z.string().length(64), mime: z.string() })), h(async (req, res) => {
  const gr = await prisma.gradeRequest.findFirst({ where: { id: req.params.id, fromSchoolId: inst(req), status: "PENDING" } });
  if (!gr || !req.body.key.startsWith(`students/${gr.studentId}/creds/`)) return res.status(404).json({ error: "not_found" });
  const cred = await prisma.credential.create({ data: { studentId: gr.studentId, kind: "SCHOOL_REPORT", title: "Official report (school-issued)", storageKey: req.body.key, sha256: req.body.sha256, mime: req.body.mime } });
  await prisma.gradeRequest.update({ where: { id: gr.id }, data: { status: "FULFILLED", resultCredentialId: cred.id } });
  await notifyUsers(await applicantUserIds(gr.studentId), "GRADES_RECEIVED", "", "", { gradeRequestId: gr.id });
  res.json({ ok: true });
}));

institutions.post("/grade-requests/:id/decline", body(z.object({ reason: z.string().max(500).optional() })), h(async (req, res) => {
  const r = await prisma.gradeRequest.updateMany({ where: { id: req.params.id, fromSchoolId: inst(req), status: "PENDING" }, data: { status: "DECLINED" } });
  const gr = await prisma.gradeRequest.findUnique({ where: { id: req.params.id } });
  if (r.count && gr) await notifyUsers(await applicantUserIds(gr.studentId), "GRADES_DECLINED", "", "", { gradeRequestId: gr.id });
  res.json({ updated: r.count });
}));

// ---- Settlements (read-only for the institution)
institutions.get("/settlements", h(async (req, res) => {
  res.json(await prisma.settlement.findMany({ where: { institutionId: inst(req) }, orderBy: { periodStart: "desc" }, take: 36 }));
}));
