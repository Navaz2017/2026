import { Router } from "express";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { h } from "../middleware/validate.js";

export const sync = Router();
sync.use(authenticate);

const LIMIT = 200;
const COLLECTIONS = ["programs", "institutions", "applications", "notifications", "children", "credentials", "gradeRequests"] as const;
type Coll = (typeof COLLECTIONS)[number];

// Delta pull. Mobile keeps one cursor (ISO updatedAt) per collection and only receives rows changed since.
//   GET /sync/pull?c.programs=2026-01-01T00:00:00Z&c.applications=...
// Response is scoped by role — the same endpoint serves a parent, student and school admin different data.
// `nextSyncSeconds` carries server-controlled jitter so 70k devices never synchronise into a thundering herd,
// and the server can lengthen it under load (back-pressure) without an app release.
sync.get("/pull", h(async (req, res) => {
  const u = req.user!;
  const since = (c: Coll) => {
    const v = req.query[`c.${c}`];
    return typeof v === "string" && !isNaN(Date.parse(v)) ? new Date(v) : new Date(0);
  };
  const page = { orderBy: { updatedAt: "asc" as const }, take: LIMIT };
  const out: Partial<Record<Coll, unknown[]>> = {};

  out.programs = await prisma.program.findMany({ ...page, where: { updatedAt: { gt: since("programs") }, ...(u.role === "INSTITUTION_ADMIN" ? { institutionId: u.inst } : { status: { in: ["ACTIVE", "CLOSED"] }, institution: { status: "VERIFIED" } }) } });
  out.institutions = await prisma.institution.findMany({ ...page, where: { updatedAt: { gt: since("institutions") }, ...(u.role === "INSTITUTION_ADMIN" ? { id: u.inst } : { status: "VERIFIED" }) }, select: { id: true, name: true, type: true, district: true, address: true, status: true, updatedAt: true } });
  out.notifications = await prisma.notification.findMany({ ...page, where: { userId: u.sub, updatedAt: { gt: since("notifications") } } });

  if (u.role === "PARENT" || u.role === "STUDENT") {
    const mine = u.role === "PARENT" ? { parent: { userId: u.sub } } : { userId: u.sub };
    out.children = await prisma.student.findMany({ ...page, where: { ...mine, updatedAt: { gt: since("children") } } });
    out.applications = await prisma.application.findMany({ ...page, where: { student: mine, updatedAt: { gt: since("applications") } } });
    out.credentials = await prisma.credential.findMany({ ...page, where: { student: mine, updatedAt: { gt: since("credentials") } }, select: { id: true, studentId: true, kind: true, title: true, mime: true, updatedAt: true } });
  } else if (u.role === "INSTITUTION_ADMIN") {
    out.applications = await prisma.application.findMany({ ...page, where: { program: { institutionId: u.inst }, status: { notIn: ["DRAFT", "AWAITING_PAYMENT", "PAYMENT_SUBMITTED"] }, updatedAt: { gt: since("applications") } } });
    out.gradeRequests = await prisma.gradeRequest.findMany({ ...page, where: { fromSchoolId: u.inst, updatedAt: { gt: since("gradeRequests") } } });
  }

  const hasMore = Object.values(out).some((rows) => (rows?.length ?? 0) === LIMIT);
  const jitter = Math.floor(Math.random() * 120);
  res.set("Cache-Control", "private, no-store").json({
    data: out, hasMore,
    // Drain pages immediately; otherwise poll every 15-17 min. Push notifications (FCM/APNs) wake the app sooner for decisions.
    nextSyncSeconds: hasMore ? 1 : 900 + jitter,
    serverTime: new Date().toISOString(),
  });
}));
