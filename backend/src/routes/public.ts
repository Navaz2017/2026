import { Router } from "express";
import { prisma } from "../db.js";
import { h } from "../middleware/validate.js";
import { presignDownload } from "../lib/storage.js";
import { splitFee } from "../lib/money.js";

export const publicCatalog = Router();

// Unauthenticated, cacheable catalog: put CloudFront in front so launch-day browsing never reaches the API.
publicCatalog.get("/institutions", h(async (req, res) => {
  const rows = await prisma.institution.findMany({
    where: { status: "VERIFIED" }, select: { id: true, name: true, type: true, district: true, updatedAt: true },
    orderBy: { name: "asc" }, take: 100, skip: Math.max(0, Number(req.query.offset) || 0),
  });
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600").json(rows);
}));

publicCatalog.get("/institutions/:id", h(async (req, res) => {
  const i = await prisma.institution.findFirst({
    where: { id: req.params.id, status: "VERIFIED" },
    select: { id: true, name: true, type: true, district: true, address: true, programs: { where: { status: "ACTIVE" } }, media: { where: { approved: true } } },
  });
  if (!i) return res.status(404).json({ error: "not_found" });
  const media = await Promise.all(i.media.map(async (m) => ({ id: m.id, kind: m.kind, caption: m.caption, url: await presignDownload(m.storageKey, 3600) })));
  res.set("Cache-Control", "public, max-age=300").json({ ...i, media });
}));

// Searchable programme list for the "Browse schools" screen.
publicCatalog.get("/programs", h(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  const type = ["PRIMARY_SCHOOL", "SECONDARY_SCHOOL", "COLLEGE", "UNIVERSITY"].find((t) => t === req.query.type);
  const rows = await prisma.program.findMany({
    where: { status: "ACTIVE", institution: { status: "VERIFIED", ...(type && { type: type as any }) }, ...(q && { OR: [{ title: { contains: q, mode: "insensitive" } }, { institution: { name: { contains: q, mode: "insensitive" } } }] }) },
    select: { id: true, title: true, level: true, seats: true, seatsTaken: true, closesAt: true, applicationFee: true, institution: { select: { id: true, name: true, type: true, district: true } } },
    orderBy: { updatedAt: "desc" }, take: 50, skip: Math.max(0, Number(req.query.offset) || 0),
  });
  // Show what the applicant will actually pay (fee + current student service fee), never just the institution's fee.
  const cfg = await prisma.revenueConfig.findFirst({ where: { effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: "desc" } });
  const out = rows.map((p) => ({ ...p, totalDueMinor: splitFee(p.applicationFee, cfg?.institutionCommissionBps ?? 0, cfg?.studentServiceFeeBps ?? 0).totalDueMinor }));
  res.set("Cache-Control", "public, max-age=60").json(out);
}));

// Where applicants send the money. Set by the owner (admin PUT /payment-info).
publicCatalog.get("/payment-info", h(async (_req, res) => {
  const rows = await prisma.setting.findMany({ where: { key: { in: ["pay.AIRTEL_MONEY", "pay.MPAMBA"] } } });
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  res.set("Cache-Control", "public, max-age=60").json({ AIRTEL_MONEY: v("pay.AIRTEL_MONEY"), MPAMBA: v("pay.MPAMBA") });
}));
