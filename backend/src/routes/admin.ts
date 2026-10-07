import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../db.js";
import { authenticate, requireMfa, requireRole } from "../middleware/auth.js";
import { body, h } from "../middleware/validate.js";
import { presignDownload } from "../lib/storage.js";
import { encrypt } from "../lib/crypto.js";
import { audit } from "../lib/audit.js";
import { normalisePhone } from "../lib/phone.js";
import { announce, reconcile } from "../lib/reconcile.js";
import { notifyUsers, applicantUserIds } from "../lib/notify.js";

export const admin = Router();
admin.use(authenticate, requireRole("SYSTEM_OWNER"), requireMfa);

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
  const devices = await prisma.device.findMany({ where: { revokedAt: null }, select: { id: true, label: true, lastSeen: true } });
  const hourAgo = Date.now() - 3600_000;
  const stale = devices.filter((d) => !d.lastSeen || d.lastSeen.getTime() < hourAgo);
  const [oldPending, waitingReview, unsettled] = await Promise.all([
    prisma.payment.count({ where: { status: { in: ["PENDING", "UNDERPAID"] }, createdAt: { lt: new Date(hourAgo) } } }),
    prisma.institution.count({ where: { status: "UNDER_REVIEW", updatedAt: { lt: new Date(Date.now() - 48 * 3600_000) } } }),
    prisma.application.aggregate({ where: { payments: { some: { status: "CONFIRMED", settlementId: null } } }, _sum: { feeMinor: true, commissionMinor: true } }),
  ]);
  const alerts = [
    ...(devices.length === 0 ? [{ code: "NO_DEVICES" }] : []),
    ...stale.map((d) => ({ code: "DEVICE_STALE", label: d.label })),
    ...(oldPending ? [{ code: "PAYMENTS_STUCK", count: oldPending }] : []),
    ...(waitingReview ? [{ code: "VERIFICATION_OVERDUE", count: waitingReview }] : []),
  ];
  res.json({ users, byRole, instByStatus, appsByStatus, unmatchedSms, pendingPayments, alerts, devices: devices.length,
    owedToInstitutionsNowMinor: (unsettled._sum.feeMinor ?? 0) - (unsettled._sum.commissionMinor ?? 0),
    revenue: { grossFeesMinor: fee, commissionMinor: com, studentServiceFeesMinor: svc, ownerTotalMinor: com + svc, institutionsOwedMinor: fee - com } });
}));

// Monthly series for the dashboard charts (last N months, zero-filled).
admin.get("/stats/timeseries", h(async (req, res) => {
  const months = Math.min(24, Math.max(1, Number(req.query.months) || 12));
  const from = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - (months - 1), 1));
  const rows = await prisma.$queryRaw<{ m: Date; confirmed: bigint; gross: bigint; owner: bigint }[]>`
    SELECT date_trunc('month', p."confirmedAt") AS m, COUNT(*) AS confirmed,
           COALESCE(SUM(a."feeMinor"),0) AS gross, COALESCE(SUM(a."commissionMinor" + a."studentServiceFeeMinor"),0) AS owner
    FROM "Payment" p JOIN "Application" a ON a.id = p."applicationId"
    WHERE p.status = 'CONFIRMED' AND p."confirmedAt" >= ${from} GROUP BY 1`;
  const apps = await prisma.$queryRaw<{ m: Date; n: bigint }[]>`SELECT date_trunc('month', "createdAt") AS m, COUNT(*) AS n FROM "Application" WHERE "createdAt" >= ${from} GROUP BY 1`;
  const key = (d: Date) => d.toISOString().slice(0, 7);
  const byM = new Map(rows.map((r) => [key(r.m), r])), appsM = new Map(apps.map((r) => [key(r.m), Number(r.n)]));
  res.json(Array.from({ length: months }, (_, i) => {
    const k = key(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1)));
    const r = byM.get(k);
    return { month: k, applications: appsM.get(k) ?? 0, confirmedPayments: Number(r?.confirmed ?? 0), grossFeesMinor: Number(r?.gross ?? 0), ownerRevenueMinor: Number(r?.owner ?? 0) };
  }));
}));

// ---- Due diligence
admin.get("/institutions", h(async (req, res) => {
  const status = z.enum(["PENDING", "UNDER_REVIEW", "VERIFIED", "REJECTED", "SUSPENDED"]).optional().parse(req.query.status);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  res.json(await prisma.institution.findMany({
    where: { status, ...(q && { name: { contains: q, mode: "insensitive" } }) },
    include: { documents: { select: { id: true, kind: true, mime: true, createdAt: true } }, users: { where: { role: "INSTITUTION_ADMIN" }, select: { fullName: true, email: true, phone: true } }, _count: { select: { programs: true } } },
    orderBy: { updatedAt: "desc" }, take: 100,
  }));
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

// ---- Numbers applicants pay to (shown in the app at payment time)
admin.put("/payment-info", body(z.object({ AIRTEL_MONEY: z.string().optional(), MPAMBA: z.string().optional() })), h(async (req, res) => {
  for (const k of ["AIRTEL_MONEY", "MPAMBA"] as const) {
    const raw = req.body[k]; if (raw === undefined) continue;
    const phone = normalisePhone(raw);
    if (!phone) return res.status(400).json({ error: "invalid_phone" });
    await prisma.setting.upsert({ where: { key: `pay.${k}` }, create: { key: `pay.${k}`, value: phone }, update: { value: phone } });
  }
  await audit(req, "payment_info.set", "Setting", undefined, req.body);
  res.json({ ok: true });
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
  res.json(await prisma.settlement.findMany({ include: { institution: { select: { name: true, payoutProvider: true, payoutPhone: true } } }, orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }], take: 300 }));
}));

// Payout sheet for paying institutions in bulk. Cells starting with = + - @ are neutralised (CSV/formula injection).
const csvCell = (v: unknown) => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
admin.get("/settlements/export.csv", h(async (req, res) => {
  const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(req.query.month);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const rows = await prisma.settlement.findMany({ where: { periodStart: new Date(Date.UTC(y, m - 1, 1)) }, include: { institution: true } });
  const head = ["institution", "payout_provider", "payout_phone", "gross_fees_mwk", "commission_mwk", "net_payable_mwk", "status", "payout_ref"];
  const lines = rows.map((r) => [r.institution.name, r.institution.payoutProvider, r.institution.payoutPhone, r.grossFeesMinor / 100, r.commissionMinor / 100, r.netPayableMinor / 100, r.status, r.payoutRef].map(csvCell).join(","));
  await audit(req, "settlement.export", "Settlement", undefined, { month });
  res.type("text/csv").set("Content-Disposition", `attachment; filename="payouts-${month}.csv"`).send([head.join(","), ...lines].join("\n"));
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

// Payment list for the "Payments & SMS" screen.
admin.get("/payments", h(async (req, res) => {
  const status = z.enum(["PENDING", "CONFIRMED", "REJECTED", "UNDERPAID"]).optional().parse(req.query.status);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 40).toUpperCase() : "";
  res.json(await prisma.payment.findMany({
    where: { status, ...(q && { OR: [{ reference: { contains: q } }, { payerPhone: { contains: q } }] }) },
    include: { sms: { select: { payerName: true, amountMinor: true, receivedAt: true } }, application: { select: { id: true, totalDueMinor: true, student: { select: { fullName: true } }, program: { select: { title: true, institution: { select: { name: true } } } } } } },
    orderBy: { createdAt: "desc" }, take: 200,
  }));
}));

// When the SMS never arrives (phone off, odd wording) the owner can confirm by hand — a written reason is mandatory and audited.
admin.post("/payments/:id/manual-confirm", body(z.object({ reason: z.string().min(10).max(500) })), h(async (req, res) => {
  const p = await prisma.payment.findUnique({ where: { id: req.params.id }, include: { application: { include: { program: true } } } });
  if (!p || !["PENDING", "UNDERPAID"].includes(p.status)) return res.status(409).json({ error: "not_confirmable" });
  await prisma.$transaction([
    prisma.payment.update({ where: { id: p.id }, data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedById: req.user!.sub, manualReason: req.body.reason } }),
    prisma.application.update({ where: { id: p.applicationId }, data: { status: "SUBMITTED" } }),
  ]);
  await audit(req, "payment.manual_confirm", "Payment", p.id, { reason: req.body.reason, reference: p.reference });
  await announce(p.application, true);
  res.json({ ok: true });
}));

// Reject (e.g. fake reference). The reference stays burned; the applicant may submit a different one.
admin.post("/payments/:id/reject", body(z.object({ reason: z.string().min(5).max(500) })), h(async (req, res) => {
  const p = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!p || !["PENDING", "UNDERPAID"].includes(p.status)) return res.status(409).json({ error: "not_rejectable" });
  const a = await prisma.application.findUniqueOrThrow({ where: { id: p.applicationId } });
  await prisma.$transaction([
    prisma.payment.update({ where: { id: p.id }, data: { status: "REJECTED", manualReason: req.body.reason } }),
    prisma.application.update({ where: { id: a.id }, data: { status: "AWAITING_PAYMENT" } }),
  ]);
  await audit(req, "payment.reject", "Payment", p.id, { reason: req.body.reason });
  await notifyUsers(await applicantUserIds(a.studentId), "PAYMENT_REJECTED", "", "", { applicationId: a.id });
  res.json({ ok: true });
}));

admin.post("/payments/:id/retry-match", h(async (req, res) => {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: req.params.id } });
  res.json({ matched: await reconcile(p.provider, [p.reference]) });
}));

// ---- SMS forwarder devices. The key is shown exactly once.
admin.get("/devices", h(async (_req, res) => {
  res.json(await prisma.device.findMany({ select: { id: true, label: true, lastSeen: true, revokedAt: true, createdAt: true, _count: { select: { messages: true } } }, orderBy: { createdAt: "desc" } }));
}));

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
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  res.json(await prisma.user.findMany({ where: { role, ...(q && { OR: [{ email: { contains: q, mode: "insensitive" } }, { fullName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] }) }, select: { id: true, email: true, fullName: true, role: true, language: true, mfaEnabled: true, disabledAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100, skip: Math.max(0, Number(req.query.offset) || 0) }));
}));

admin.post("/users/:id/disable", h(async (req, res) => {
  await prisma.user.update({ where: { id: req.params.id }, data: { disabledAt: new Date() } });
  await prisma.refreshToken.updateMany({ where: { userId: req.params.id }, data: { revokedAt: new Date() } });
  await audit(req, "user.disable", "User", req.params.id);
  res.status(204).end();
}));

// A school staff member lost their phone and has no recovery codes: the owner turns off their two-step security;
// they sign in with their password and set it up again. Audited. (Owners reset their own via scripts/reset-mfa.ts on the server.)
admin.post("/users/:id/reset-mfa", h(async (req, res) => {
  if (req.params.id === req.user!.sub) return res.status(400).json({ error: "cannot_reset_self" });
  await prisma.$transaction([
    prisma.user.update({ where: { id: req.params.id }, data: { mfaEnabled: false, mfaSecret: null } }),
    prisma.mfaRecoveryCode.deleteMany({ where: { userId: req.params.id } }),
    prisma.refreshToken.updateMany({ where: { userId: req.params.id }, data: { revokedAt: new Date() } }),
  ]);
  await audit(req, "user.reset_mfa", "User", req.params.id);
  res.status(204).end();
}));

admin.post("/users/:id/enable", h(async (req, res) => {
  await prisma.user.update({ where: { id: req.params.id }, data: { disabledAt: null, failedLogins: 0, lockedUntil: null } });
  await audit(req, "user.enable", "User", req.params.id);
  res.status(204).end();
}));

admin.get("/audit", h(async (req, res) => {
  const action = typeof req.query.action === "string" ? req.query.action.slice(0, 60) : undefined;
  res.json(await prisma.auditLog.findMany({ where: action ? { action: { startsWith: action } } : {}, orderBy: { createdAt: "desc" }, take: 300 }));
}));
