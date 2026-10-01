import { Router } from "express";
import { prisma } from "../db.js";
import { h } from "../middleware/validate.js";
import { presignDownload } from "../lib/storage.js";

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
