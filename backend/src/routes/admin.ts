import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../db.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { body, h } from "../middleware/validate.js";
import { presignDownload } from "../lib/storage.js";
import { encrypt } from "../lib/crypto.js";
import { audit } from "../lib/audit.js";
import { reconcile } from "../lib/reconcile.js";

export const admin = Router();
admin.use(authenticate, requireRole("SYSTEM_OWNER"));

admin.get("/dashboard", h(async (_req, res) => {
  const [users, byRole, instByStatus, appsByStatus, paid, unmatchedSms, pendingPayments] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ["role"], _count: true }),
    prisma.institution.groupBy({ by: ["status"], _count: true }),
    prisma.application.groupBy({ by: ["status"], _count: true }),
    prisma.application.aggregate({ where: { payments: { some: { status: "CONFIRMED" } } }, _sum: { feeMinor: true, studentServiceFeeMinor: true, commissionMinor: true } }),
    prisma.smsMessage.count({ where: { payment: null } }),
    prisma.payment.count({ where: { status: { in: ["PENDING", "UNDERPAID"] } } }),
  ]);
  const fee = paid._sum.feeMinor ?? 0, svc = paid._sum.studentServiceFeeMinor ?? 0, com = paid._sum.commissionMinor ?? 0;
  res.json({ users, byRole, instByStatus, appsByStatus, unmatchedSms, pendingPayments,
    revenue: { grossFeesMinor: fee, commissionMinor: com, studentServiceFeesMinor: svc, ownerTotalMinor: com + svc, institutionsOwedMinor: fee - com } });
}));

// ---- Due diligence
admin.get("/institutions", h(async (req, res) => {
  const status = z.enum(["PENDING", "UNDER_REVIEW", "VERIFIED", "REJECTED", "SUSPENDED"]).optional().parse(req.query.status);
  res.json(await prisma.institution.findMany({ where: { status }, include: { documents: true }, orderBy: { updatedAt: "desc" }, take: 100 }));
}));

admin.get("/documents/:id/download", h(async (req, res) => {
  const d = await prisma.institutionDocument.findUniqueOrThrow({ where: { id: req.params.id } });
  await audit(req, "document.view", "InstitutionDocument", d.id);
  res.json({ url: await presignDownload(d.storageKey, 60) });
}));

admin.post("/institutions/:id/review", body(z.object({ decision: z.enum(["VERIFIED", "REJECTED", "SUSPENDED"]), note: z.string().max(1000).optional() })), h(async (req, res) => {
  const id = req.params.id!;
  await prisma.$transaction(async (tx) => {
    await tx.institution.update({ where: { id }, data: { status: req.body.decision, reviewNote: req.body.note, verifiedAt: req.body.decision === "VERIFIED" ? new Date() : null } });
    // Programs uploaded early go live on verification; they go dark again on suspension.
    if (req.body.decision === "VERIFIED") await tx.program.updateMany({ where: { institutionId: id, status: "PENDING_VERIFICATION" }, data: { status: "ACTIVE" } });
    if (req.body.decision === "SUSPENDED") await tx.program.updateMany({ where: { institutionId: id, status: "ACTIVE" }, data: { status: "PENDING_VERIFICATION" } });
    if (req.body.decision === "VERIFIED") await tx.media.updateMany({ where: { institutionId: id }, data: { approved: true } });
  });
  await audit(req, `institution.${req.body.decision}`, "Institution", id, { note: req.body.note });
  res.json({ ok: true });
}));

// ---- Revenue sharing. Append-only: history is preserved, applications keep the rates they were created under.
admin.get("/revenue-config", h(async (_req, res) => {
  res.json(await prisma.revenueConfig.findMany({ orderBy: { effectiveFrom: "desc" }, take: 20 }));
}));

admin.put("/revenue-config", body(z.object({
  institutionCommissionBps: z.number().int().min(0).max(10_000), studentServiceFeeBps: z.number().int().min(0).max(10_000),
  effectiveFrom: z.coerce.date().optional(),
})), h(async (req, res) => {
  const row = await prisma.revenueConfig.create({ data: { ...req.body, createdById: req.user!.sub } });
  await audit(req, "revenue_config.set", "RevenueConfig", row.id, req.body);
  res.status(201).json(row);
}));

// ---- Month-end settlement. Idempotent: payments already attached to a settlement are skipped.
admin.post("/settlements/run", body(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })), h(async (req, res) => {
  const [y, m] = req.body.month.split("-").map(Number) as [number, number];
  const periodStart = new Date(Date.UTC(y, m - 1, 1)), periodEnd = new Date(Date.UTC(y, m, 1));
  const payments = await prisma.payment.findMany({
    where: { status: "CONFIRMED", settlementId: null, confirmedAt: { gte: periodStart, lt: periodEnd } },
    include: { application: { include: { program: { select: { institutionId: true } } } } },
  });
  const byInst = new Map<string, typeof payments>();
  for (const p of payments) byInst.set(p.application.program.institutionId, [...(byInst.get(p.application.program.institutionId) ?? []), p]);
  const created = [];
  for (const [institutionId, ps] of byInst) {
    const sum = (f: (a: (typeof ps)[number]["application"]) => number) => ps.reduce((s, p) => s + f(p.application), 0);
    const gross = sum((a) => a.feeMinor), com = sum((a) => a.commissionMinor);
    created.push(await prisma.$transaction(async (tx) => {
      const s = await tx.settlement.upsert({
        where: { institutionId_periodStart_periodEnd: { institutionId, periodStart, periodEnd } },
        create: { institutionId, periodStart, periodEnd, grossFeesMinor: gross, commissionMinor: com, studentServiceFeesMinor: sum((a) => a.studentServiceFeeMinor), netPayableMinor: gross - com },
        update: {},
      });
      await tx.payment.updateMany({ where: { id: { in: ps.map((p) => p.id) }, settlementId: null }, data: { settlementId: s.id } });
      return s;
    }));
  }
  await audit(req, "settlement.run", "Settlement", undefined, { month: req.body.month, count: created.length });
  res.json(created);
}));

admin.get("/settlements", h(async (_req, res) => {
  res.json(await prisma.settlement.findMany({ orderBy: { periodStart: "desc" }, take: 200 }));
}));

admin.post("/settlements/:id/mark-paid", body(z.object({ payoutRef: z.string().min(4) })), h(async (req, res) => {
  const r = await prisma.settlement.updateMany({ where: { id: req.params.id, status: { in: ["OPEN", "APPROVED"] } }, data: { status: "PAID", payoutRef: req.body.payoutRef } });
  await audit(req, "settlement.paid", "Settlement", req.params.id, { payoutRef: req.body.payoutRef });
  res.json({ updated: r.count });
}));

// ---- Payments / SMS exceptions
admin.get("/sms/unmatched", h(async (_req, res) => {
  res.json(await prisma.smsMessage.findMany({ where: { payment: null }, orderBy: { receivedAt: "desc" }, take: 200 }));
}));

admin.post("/payments/:id/retry-match", h(async (req, res) => {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: req.params.id } });
  res.json({ matched: await reconcile(p.provider, p.reference) });
}));

// ---- SMS forwarder devices. The key is shown exactly once.
admin.post("/devices", body(z.object({ label: z.string().min(2) })), h(async (req, res) => {
  const key = crypto.randomBytes(32).toString("hex");
  const d = await prisma.device.create({ data: { label: req.body.label, keyEnc: encrypt(key) } });
  await audit(req, "device.create", "Device", d.id);
  res.status(201).json({ id: d.id, key });
}));

admin.delete("/devices/:id", h(async (req, res) => {
  await prisma.device.update({ where: { id: req.params.id }, data: { revokedAt: new Date() } });
  await audit(req, "device.revoke", "Device", req.params.id);
  res.status(204).end();
}));

// ---- Users
admin.get("/users", h(async (req, res) => {
  const role = z.enum(["SYSTEM_OWNER", "INSTITUTION_ADMIN", "PARENT", "STUDENT"]).optional().parse(req.query.role);
  res.json(await prisma.user.findMany({ where: { role }, select: { id: true, email: true, fullName: true, role: true, disabledAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100, skip: Math.max(0, Number(req.query.offset) || 0) }));
}));

admin.post("/users/:id/disable", h(async (req, res) => {
  await prisma.user.update({ where: { id: req.params.id }, data: { disabledAt: new Date() } });
  await prisma.refreshToken.updateMany({ where: { userId: req.params.id }, data: { revokedAt: new Date() } });
  await audit(req, "user.disable", "User", req.params.id);
  res.status(204).end();
}));

admin.get("/audit", h(async (_req, res) => {
  res.json(await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 }));
}));
