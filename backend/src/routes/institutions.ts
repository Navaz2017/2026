import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { body, h } from "../middleware/validate.js";
import { presignUpload } from "../lib/storage.js";
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
  res.json(await prisma.institution.update({ where: { id: inst(req) }, data: req.body }));
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

// Letter templates (acceptance / rejection) customised by the institution.
institutions.put("/letter-templates/:kind", body(z.object({ body: z.string().min(20).max(10_000), signatory: z.string().max(120).optional() })), h(async (req, res) => {
  const kind = z.enum(["ACCEPTANCE", "REJECTION"]).parse(req.params.kind);
  res.json(await prisma.letterTemplate.upsert({
    where: { institutionId_kind: { institutionId: inst(req), kind } },
    create: { institutionId: inst(req), kind, ...req.body }, update: req.body,
  }));
}));

// Applications to this institution — only ones that have been paid for (SUBMITTED and later).
institutions.get("/applications", h(async (req, res) => {
  res.json(await prisma.application.findMany({
    where: { program: { institutionId: inst(req) }, status: { in: ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED"] } },
    include: { student: { include: { credentials: { select: { id: true, kind: true, title: true } } } }, program: { select: { title: true } } },
    orderBy: { updatedAt: "desc" }, take: 200,
  }));
}));

institutions.post("/applications/:id/decision", body(z.object({ decision: z.enum(["ACCEPTED", "REJECTED"]), note: z.string().max(1000).optional() })), h(async (req, res) => {
  const { letterQueue } = await import("../jobs/queue.js");
  const r = await prisma.application.updateMany({
    where: { id: req.params.id, program: { institutionId: inst(req) }, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
    data: { status: req.body.decision, decisionNote: req.body.note, decidedAt: new Date() },
  });
  if (!r.count) return res.status(404).json({ error: "not_found_or_already_decided" });
  await letterQueue.add("letter", { applicationId: req.params.id! }, { jobId: `letter:${req.params.id}`, attempts: 5, backoff: { type: "exponential", delay: 5000 } });
  await audit(req, `application.${req.body.decision}`, "Application", req.params.id);
  res.json({ ok: true });
}));

// Inbox of grade requests from students transferring FROM this school.
institutions.get("/grade-requests", h(async (req, res) => {
  res.json(await prisma.gradeRequest.findMany({ where: { fromSchoolId: inst(req), status: "PENDING" }, include: { student: true } }));
}));

institutions.post("/grade-requests/:id/fulfil", body(z.object({ key: z.string(), sha256: z.string().length(64), mime: z.string() })), h(async (req, res) => {
  const gr = await prisma.gradeRequest.findFirst({ where: { id: req.params.id, fromSchoolId: inst(req), status: "PENDING" } });
  if (!gr) return res.status(404).json({ error: "not_found" });
  const cred = await prisma.credential.create({ data: { studentId: gr.studentId, kind: "SCHOOL_REPORT", title: "Official report (school-issued)", storageKey: req.body.key, sha256: req.body.sha256, mime: req.body.mime } });
  await prisma.gradeRequest.update({ where: { id: gr.id }, data: { status: "FULFILLED", resultCredentialId: cred.id } });
  res.json({ ok: true });
}));
