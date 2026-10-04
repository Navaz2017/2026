import { Router } from "express";
import { prisma } from "../db.js";
import { h } from "../middleware/validate.js";
import { presignDownload } from "../lib/storage.js";
import { splitFee } from "../lib/money.js";
import { Prisma } from "@prisma/client";

export const publicCatalog = Router();

// Unauthenticated, cacheable catalog: put CloudFront in front so launch-day browsing never reaches the API.
publicCatalog.get("/institutions", h(async (req, res) => {
  const rows = await prisma.institution.findMany({
    where: { status: "VERIFIED" }, select: { id: true, name: true, type: true, district: true, updatedAt: true },
    orderBy: { name: "asc" }, take: 100, skip: Math.max(0, Number(req.query.offset) || 0),
  });
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600").json(rows);
}));

const PROGRAM_FIELDS = { id: true, title: true, level: true, code: true, description: true, seats: true, seatsTaken: true, applicationFee: true, tuitionFeeMinor: true, tuitionPeriod: true, duration: true, entryRequirements: true, modes: true, classLevel: true, syllabus: true, closesAt: true, opensAt: true, status: true } satisfies Prisma.ProgramSelect;

const currentRates = () => prisma.revenueConfig.findFirst({ where: { effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: "desc" } });
const withTotal = <T extends { applicationFee: number }>(p: T, cfg: { institutionCommissionBps: number; studentServiceFeeBps: number } | null) =>
  ({ ...p, totalDueMinor: splitFee(p.applicationFee, cfg?.institutionCommissionBps ?? 0, cfg?.studentServiceFeeBps ?? 0).totalDueMinor });

// One page of everything an applicant wants to see about a school. `preview` lets the school see its own page
// before it is verified, including photos/videos still hidden from the public.
export async function schoolPage(id: string, preview: boolean) {
  const i = await prisma.institution.findFirst({
    where: { id, ...(preview ? {} : { status: "VERIFIED" }) },
    select: { id: true, name: true, type: true, status: true, district: true, address: true, description: true, website: true, contactEmail: true, contactPhone: true, campuses: true, highestLevel: true, syllabi: true, otherFees: true,
      programs: { where: { status: preview ? { in: ["ACTIVE", "PENDING_VERIFICATION", "DRAFT"] } : "ACTIVE" }, select: PROGRAM_FIELDS, orderBy: [{ classLevel: "asc" }, { title: "asc" }] },
      media: { where: preview ? {} : { approved: true }, orderBy: { createdAt: "desc" } } },
  });
  if (!i) return null;
  const cfg = await currentRates();
  const media = await Promise.all(i.media.map(async (m) => ({ id: m.id, kind: m.kind, caption: m.caption, approved: m.approved, url: await presignDownload(m.storageKey, 3600) })));
  return { ...i, programs: i.programs.map((p) => withTotal(p, cfg)), media };
}

publicCatalog.get("/institutions/:id", h(async (req, res) => {
  const page = await schoolPage(req.params.id!, false);
  if (!page) return res.status(404).json({ error: "not_found" });
  res.set("Cache-Control", "public, max-age=300").json(page);
}));

// Searchable programme list for the "Browse schools" screen.
publicCatalog.get("/programs", h(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  const type = ["PRIMARY_SCHOOL", "SECONDARY_SCHOOL", "COLLEGE", "UNIVERSITY"].find((t) => t === req.query.type);
  const rows = await prisma.program.findMany({
    where: { status: "ACTIVE", institution: { status: "VERIFIED", ...(type && { type: type as any }) }, ...(q && { OR: [{ title: { contains: q, mode: "insensitive" } }, { institution: { name: { contains: q, mode: "insensitive" } } }] }) },
    select: { ...PROGRAM_FIELDS, institution: { select: { id: true, name: true, type: true, district: true } } },
    orderBy: { updatedAt: "desc" }, take: 50, skip: Math.max(0, Number(req.query.offset) || 0),
  });
  // Show what the applicant will actually pay (fee + current student service fee), never just the institution's fee.
  const cfg = await currentRates();
  const out = rows.map((p) => withTotal(p, cfg));
  res.set("Cache-Control", "public, max-age=60").json(out);
}));

// Where applicants send the money. Set by the owner (admin PUT /payment-info).
publicCatalog.get("/payment-info", h(async (_req, res) => {
  const rows = await prisma.setting.findMany({ where: { key: { in: ["pay.AIRTEL_MONEY", "pay.MPAMBA"] } } });
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  res.set("Cache-Control", "public, max-age=60").json({ AIRTEL_MONEY: v("pay.AIRTEL_MONEY"), MPAMBA: v("pay.MPAMBA") });
}));
