import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireMfa, requireRole, requireVerifiedPhone } from "../middleware/auth.js";
import { body, h } from "../middleware/validate.js";
import { presignDownload, presignUpload } from "../lib/storage.js";
import { DEFAULT_TEMPLATES, renderLetter } from "../lib/letters.js";
import { enqueueLetter } from "../jobs/queue.js";
import { applicantUserIds, notifyUsers } from "../lib/notify.js";
import { publishDecision, releaseHeld } from "../lib/decisions.js";
import { sendViaSession, waWorkerOnline } from "../lib/messaging.js";
import { normalisePhone } from "../lib/phone.js";
import { ALL_LEVELS, MODES, TUITION_PERIODS, allowedLevels, isSchool, levelLabel, syllabiForLevel } from "../lib/levels.js";
import { schoolPage } from "./public.js";
import { audit } from "../lib/audit.js";

export const institutions = Router();
institutions.use(authenticate, requireRole("INSTITUTION_ADMIN"));

// Every handler is scoped to req.user.inst — an admin can never name another institution's id.
const inst = (req: any) => req.user!.inst as string;

institutions.get("/me", h(async (req, res) => {
  res.json(await prisma.institution.findUnique({ where: { id: inst(req) }, include: { documents: true } }));
}));

const otherFee = z.object({ name: z.string().min(1).max(80), amountMinor: z.number().int().min(0), period: z.enum(TUITION_PERIODS) });
institutions.patch("/me", body(z.object({
  address: z.string().optional(), contactPhone: z.string().optional(),
  payoutProvider: z.enum(["AIRTEL_MONEY", "MPAMBA"]).optional(), payoutPhone: z.string().optional(),
  description: z.string().max(2000).optional(), website: z.string().url().max(200).or(z.literal("")).optional(),
  campuses: z.array(z.string().min(1).max(60)).max(10).optional(),
  highestLevel: z.enum(ALL_LEVELS as [string, ...string[]]).nullable().optional(), syllabi: z.array(z.enum(["MSCE", "CAMBRIDGE"])).max(2).optional(),
  otherFees: z.array(otherFee).max(20).optional(),
}).strict()), h(async (req, res) => {
  const me = await prisma.institution.findUniqueOrThrow({ where: { id: inst(req) } });
  const phone = req.body.payoutPhone ? normalisePhone(req.body.payoutPhone) : undefined;
  if (req.body.payoutPhone && !phone) return res.status(400).json({ error: "invalid_phone" });
  const { highestLevel, syllabi } = req.body;
  if (highestLevel) {
    if (!isSchool(me.type) || !(me.type === "PRIMARY_SCHOOL" ? highestLevel.startsWith("STD") : highestLevel.startsWith("F"))) return res.status(422).json({ error: "level_not_for_this_school" });
    if ((highestLevel === "F5" || highestLevel === "F6") && !(syllabi ?? me.syllabi).includes("CAMBRIDGE")) return res.status(422).json({ error: "cambridge_required_above_form_4" });
  }
  const { otherFees, ...rest } = req.body;
  res.json(await prisma.institution.update({ where: { id: me.id }, data: { ...rest, ...(otherFees && { otherFees }), ...(phone && { payoutPhone: phone }) } }));
}));

// What applicants see (including photos/videos not yet public) — so the school can check its own page before going live.
institutions.get("/preview", h(async (req, res) => {
  res.set("Cache-Control", "no-store").json(await schoolPage(inst(req), true));
}));

// Step 1: ask for an upload slot. Step 2: client PUTs the file to S3. Step 3: client confirms (below).
const fileMeta = z.object({ mime: z.string(), size: z.number().int().positive(), kind: z.string().max(40) });
institutions.post("/me/documents/upload-url", requireVerifiedPhone, body(fileMeta), h(async (req, res) => {
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
  title: z.string().min(2).max(120), level: z.string().min(1).max(60), code: z.string().max(20).optional(), description: z.string().max(2000).optional(),
  seats: z.number().int().min(1), applicationFee: z.number().int().min(0),
  tuitionFeeMinor: z.number().int().min(0), tuitionPeriod: z.enum(TUITION_PERIODS).default("SEMESTER"),
  duration: z.string().max(40).optional(), entryRequirements: z.string().max(1000).optional(), modes: z.array(z.enum(MODES)).max(5).default([]),
  classLevel: z.enum(ALL_LEVELS as [string, ...string[]]).optional(), syllabus: z.enum(["MSCE", "CAMBRIDGE"]).optional(),
  opensAt: z.coerce.date().optional(), closesAt: z.coerce.date().optional(),
});

institutions.get("/programs", h(async (req, res) => {
  res.json(await prisma.program.findMany({ where: { institutionId: inst(req) }, orderBy: [{ classLevel: "asc" }, { updatedAt: "desc" }] }));
}));

institutions.post("/programs", body(programBody), h(async (req, res) => {
  const i = await prisma.institution.findUniqueOrThrow({ where: { id: inst(req) } });
  const status = i.status === "VERIFIED" ? "ACTIVE" : "PENDING_VERIFICATION";
  let data = { ...req.body };
  if (isSchool(i.type)) {
    // Schools offer class levels, not courses: Standard 1-8 or Form 1-4 (MSCE) / up to Form 6 (Cambridge), up to the highest level they declared.
    if (!i.highestLevel) return res.status(422).json({ error: "set_highest_level_first" });
    if (!data.classLevel || !allowedLevels(i).includes(data.classLevel)) return res.status(422).json({ error: "level_above_highest" });
    if (i.type === "SECONDARY_SCHOOL") {
      const ok = syllabiForLevel(data.classLevel).filter((x) => i.syllabi.includes(x));
      if (!data.syllabus || !ok.includes(data.syllabus)) return res.status(422).json({ error: "syllabus_not_offered" });
    } else data.syllabus = undefined;
    if (await prisma.program.count({ where: { institutionId: i.id, classLevel: data.classLevel, syllabus: data.syllabus ?? null, status: { not: "CLOSED" } } })) return res.status(409).json({ error: "duplicate_level" });
    data = { ...data, title: levelLabel(data.classLevel) + (data.syllabus ? ` (${data.syllabus})` : ""), level: levelLabel(data.classLevel) };
  } else { data.classLevel = undefined; data.syllabus = undefined; }
  res.status(201).json(await prisma.program.create({ data: { ...data, institutionId: i.id, status } }));
}));

institutions.patch("/programs/:id", body(programBody.omit({ classLevel: true, syllabus: true }).partial().extend({ status: z.enum(["CLOSED"]).optional() }).strict()), h(async (req, res) => {
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
  res.json(await Promise.all(rows.map(async (m) => ({ id: m.id, kind: m.kind, caption: m.caption, approved: m.approved, url: await presignDownload(m.storageKey, 3600) }))));
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
    select: { id: true, status: true, createdAt: true, updatedAt: true, decidedAt: true, decisionPublishedAt: true, student: { select: { id: true, fullName: true, gender: true, dateOfBirth: true } }, program: { select: { id: true, title: true } } },
    orderBy: { updatedAt: "desc" }, take: 200,
  }));
}));

// Full applicant file: profile, parent occupation, statement, attached credentials (metadata only; files via signed URL below).
institutions.get("/applications/:id", h(async (req, res) => {
  const a = await prisma.application.findFirst({
    where: { id: req.params.id, program: { institutionId: inst(req) }, status: { in: [...VISIBLE] } },
    include: { program: { select: { title: true, level: true, seats: true, seatsTaken: true } }, choices: { orderBy: { rank: "asc" }, include: { program: { select: { id: true, title: true, level: true, seats: true, seatsTaken: true, classLevel: true, syllabus: true, tuitionFeeMinor: true, tuitionPeriod: true } } } }, student: { include: { parent: { select: { occupation: true, employer: true, user: { select: { fullName: true, phone: true, email: true } } } } } } },
  });
  if (!a) return res.status(404).json({ error: "not_found" });
  const fulfilled = await prisma.gradeRequest.findMany({ where: { studentId: a.studentId, status: "FULFILLED", resultCredentialId: { not: null } }, select: { resultCredentialId: true } });
  const ids = [...a.attachedCredentialIds, ...fulfilled.map((g) => g.resultCredentialId!)];
  const credentials = await prisma.credential.findMany({ where: { id: { in: ids }, studentId: a.studentId }, select: { id: true, kind: true, title: true, mime: true, createdAt: true } });
  const { attachedCredentialIds: _x, ...rest } = a;
  const { payment: _pay, ...formForSchool } = (rest.form ?? {}) as Record<string, unknown>; // how the applicant paid is none of the school's business
  res.json({ ...rest, form: formForSchool, credentials });
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

institutions.post("/applications/:id/decision", requireMfa, body(z.object({ decision: z.enum(["ACCEPTED", "REJECTED"]), note: z.string().max(1000).optional(), programId: z.string().uuid().optional(), letter: z.enum(["NOW", "HOLD"]).optional() })), h(async (req, res) => {
  const a = await prisma.application.findFirst({ where: { id: req.params.id, program: { institutionId: inst(req) }, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } }, include: { choices: true } });
  if (!a) return res.status(404).json({ error: "not_found_or_already_decided" });
  // Accepting means offering ONE of the applicant's ranked choices (default: first choice).
  const offered = req.body.decision === "ACCEPTED" ? (req.body.programId ?? a.programId) : null;
  if (offered && !a.choices.some((c) => c.programId === offered)) return res.status(400).json({ error: "not_a_choice" });
  const ok = await prisma.$transaction(async (tx) => {
    // Seat accounting is atomic: two admins accepting the last seat at once cannot both succeed.
    if (offered) {
      const seat = await tx.$queryRaw<unknown[]>`UPDATE "Program" SET "seatsTaken" = "seatsTaken" + 1 WHERE id = ${offered} AND "seatsTaken" < seats RETURNING 1`;
      if (!seat.length) return false;
    }
    const r = await tx.application.updateMany({ where: { id: a.id, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } }, data: { status: req.body.decision, decisionNote: req.body.note, decidedAt: new Date(), offeredProgramId: offered } });
    if (!r.count) throw new Error("concurrent_decision");
    return true;
  });
  if (!ok) return res.status(409).json({ error: "no_seats_left" });
  await audit(req, `application.${req.body.decision}`, "Application", a.id, offered ? { offeredProgramId: offered } : undefined);
  // Send the letter now, or keep the decision private until the registrar releases all held letters together.
  const letterMode = req.body.letter ?? ((await prisma.institution.findUniqueOrThrow({ where: { id: inst(req) }, select: { letterMode: true } })).letterMode === "HOLD" ? "HOLD" : "NOW");
  const held = letterMode === "HOLD";
  if (!held) await publishDecision(a.id);
  else await audit(req, "application.letter_held", "Application", a.id);
  res.json({ ok: true, held });
}));

// ---- Held decision letters: release together, schedule a date, or release one
institutions.get("/letters/pending", h(async (req, res) => {
  const [i, items] = await Promise.all([
    prisma.institution.findUniqueOrThrow({ where: { id: inst(req) }, select: { letterMode: true, lettersReleaseAt: true } }),
    prisma.application.findMany({ where: { program: { institutionId: inst(req) }, decidedAt: { not: null }, decisionPublishedAt: null, status: { in: ["ACCEPTED", "REJECTED"] } }, select: { id: true, status: true, decidedAt: true, student: { select: { fullName: true } }, program: { select: { title: true } } }, orderBy: { decidedAt: "asc" }, take: 500 }),
  ]);
  res.json({ mode: i.letterMode, releaseAt: i.lettersReleaseAt, accepted: items.filter((x) => x.status === "ACCEPTED").length, rejected: items.filter((x) => x.status === "REJECTED").length, items });
}));

institutions.put("/letters/settings", requireMfa, body(z.object({ mode: z.enum(["IMMEDIATE", "HOLD"]), releaseAt: z.string().datetime().nullable().optional() })), h(async (req, res) => {
  const at = req.body.mode === "HOLD" && req.body.releaseAt ? new Date(req.body.releaseAt) : null;
  if (at && at.getTime() < Date.now() - 60_000) return res.status(400).json({ error: "date_in_past" });
  await prisma.institution.update({ where: { id: inst(req) }, data: { letterMode: req.body.mode, lettersReleaseAt: at } });
  await audit(req, "letters.settings", "Institution", inst(req), { mode: req.body.mode, releaseAt: at?.toISOString() ?? null });
  res.json({ ok: true });
}));

institutions.post("/letters/release", requireMfa, h(async (req, res) => {
  const released = await releaseHeld(inst(req));
  await prisma.institution.update({ where: { id: inst(req) }, data: { lettersReleaseAt: null } }); // the scheduled date (if any) is used up
  await audit(req, "letters.release_all", "Institution", inst(req), { released });
  res.json({ released });
}));

institutions.post("/applications/:id/release", requireMfa, h(async (req, res) => {
  const a = await prisma.application.findFirst({ where: { id: req.params.id, program: { institutionId: inst(req) }, decidedAt: { not: null }, decisionPublishedAt: null } });
  if (!a || !(await publishDecision(a.id))) return res.status(404).json({ error: "not_held" });
  await audit(req, "application.letter_released", "Application", a.id);
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

// ---- WhatsApp linking: every institution links ITS OWN number (whatsapp-web.js runs in the separate wa-worker process;
// we only exchange state through the database). Two ways to link: scan a QR, or type an 8-character code on the phone.
institutions.get("/whatsapp", h(async (req, res) => {
  const [s, i, online] = await Promise.all([prisma.whatsAppSession.findUnique({ where: { institutionId: inst(req) } }), prisma.institution.findUniqueOrThrow({ where: { id: inst(req) }, select: { status: true } }), waWorkerOnline()]);
  res.set("Cache-Control", "no-store").json({
    desired: s?.desired ?? false, status: s?.status ?? "DISCONNECTED", phone: s?.phone ?? null, lastError: s?.lastError ?? null,
    qr: s?.status === "QR" ? s.qr : null, pairingCode: s?.status === "CODE" ? s.pairingCode : null, pairPhone: s?.pairPhone ?? null, // secrets only while pairing
    workerOnline: online, institutionVerified: i.status === "VERIFIED", mfa: !!req.user!.mfa,
  });
}));

institutions.post("/whatsapp/connect", requireMfa, body(z.object({ phone: z.string().min(6).max(20).optional() })), h(async (req, res) => {
  const i = await prisma.institution.findUniqueOrThrow({ where: { id: inst(req) } });
  if (i.status !== "VERIFIED") return res.status(403).json({ error: "institution_not_verified" });
  let pairPhone: string | null = null;
  if (req.body.phone) { pairPhone = normalisePhone(req.body.phone); if (!pairPhone) return res.status(400).json({ error: "invalid_phone" }); }
  const data = { desired: true, status: "STARTING", lastError: null, qr: null, pairingCode: null, pairPhone };
  await prisma.whatsAppSession.upsert({ where: { institutionId: i.id }, create: { institutionId: i.id, ...data }, update: data });
  await audit(req, "whatsapp.connect", "Institution", i.id);
  res.status(202).json({ ok: true });
}));

institutions.post("/whatsapp/disconnect", requireMfa, h(async (req, res) => {
  await prisma.whatsAppSession.updateMany({ where: { institutionId: inst(req) }, data: { desired: false, status: "DISCONNECTED", qr: null, pairingCode: null, pairPhone: null, lastError: null } }); // the page updates at once; the worker closes the browser
  await audit(req, "whatsapp.disconnect", "Institution", inst(req));
  res.status(202).json({ ok: true });
}));

// Proves the link works: a short message from THIS institution's number to a number of the admin's choice.
institutions.post("/whatsapp/test", requireMfa, body(z.object({ phone: z.string().min(6).max(20) })), h(async (req, res) => {
  const phone = normalisePhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: "invalid_phone" });
  const s = await prisma.whatsAppSession.findUnique({ where: { institutionId: inst(req) } });
  if (s?.status !== "CONNECTED") return res.status(409).json({ error: "whatsapp_not_connected" });
  if ((await prisma.waOutbox.count({ where: { sessionKey: inst(req), letterId: null, createdAt: { gt: new Date(Date.now() - 3600_000) } } })) >= 5) return res.status(429).json({ error: "otp_limit" }); // 5 test messages/hour: this is not a bulk-message tool
  const i = await prisma.institution.findUniqueOrThrow({ where: { id: inst(req) }, select: { name: true } });
  const r = await sendViaSession(inst(req), phone, `${i.name} (via Enrolla): WhatsApp is linked. Decision letters will be sent from this number.`);
  if (!r.ok) return res.status(502).json({ error: r.error === "not_on_whatsapp" ? "not_on_whatsapp" : "whatsapp_send_failed" });
  await audit(req, "whatsapp.test", "Institution", inst(req));
  res.json({ ok: true });
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
