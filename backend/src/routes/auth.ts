import { Router } from "express";
import rateLimit from "express-rate-limit";
import { config } from "../config.js";
import { z } from "zod";
import { hash, verify } from "@node-rs/argon2";
import { prisma } from "../db.js";
import { body, h } from "../middleware/validate.js";
import { authenticate, signAccess } from "../middleware/auth.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { normalisePhone } from "../lib/phone.js";
import { newSecret, verifyCode } from "../lib/totp.js";
import { sendEmail } from "../lib/mailer.js";
import { audit } from "../lib/audit.js";

export const auth = Router();

// Brute-force protection for credential endpoints only, per client IP (the web app forwards the real client IP).
// /auth/me, /refresh, notifications etc. are normal authenticated traffic and use the general per-user limiter.
const strict = rateLimit({ windowMs: 15 * 60_000, limit: config.NODE_ENV === "test" ? 10_000 : 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ip:${req.ip}` });

const password = z.string().min(10).max(128);
const language = z.enum(["en", "ny", "tum"]).default("en");
const base = {
  email: z.string().email().toLowerCase(), password, fullName: z.string().min(2).max(120), phone: z.string().optional(),
  language,
  consent: z.literal(true), // data-protection consent is mandatory (children's data)
};

// Self-service signup is limited to roles that are safe to self-register. SYSTEM_OWNER is never creatable here.
const signup = z.discriminatedUnion("role", [
  z.object({ ...base, role: z.literal("PARENT"), occupation: z.string().min(2).max(120), employer: z.string().max(120).optional() }),
  z.object({ ...base, role: z.literal("STUDENT") }),
  z.object({
    ...base,
    role: z.literal("INSTITUTION_ADMIN"),
    institution: z.object({
      name: z.string().min(2),
      type: z.enum(["PRIMARY_SCHOOL", "SECONDARY_SCHOOL", "COLLEGE", "UNIVERSITY"]),
      district: z.string().optional(),
      contactEmail: z.string().email(),
    }),
  }),
]);

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const REFRESH_DAYS = 30;

type TokenUser = { id: string; role: any; institutionId: string | null };
async function issueTokens(user: TokenUser, mfa = false, family = randomToken(16)) {
  const refresh = randomToken();
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: sha256(refresh), family, mfa, expiresAt: new Date(Date.now() + REFRESH_DAYS * 864e5) },
  });
  return { accessToken: signAccess({ sub: user.id, role: user.role, inst: user.institutionId ?? undefined, mfa }), refreshToken: refresh };
}

auth.post(
  "/signup",
  strict,
  body(signup),
  h(async (req, res) => {
    const d = req.body as z.infer<typeof signup>;
    const phone = d.phone ? normalisePhone(d.phone) : null;
    if (d.phone && !phone) return res.status(400).json({ error: "invalid_phone" });
    if (await prisma.user.findUnique({ where: { email: d.email } })) {
      // Generic response: do not reveal which emails are registered.
      return res.status(202).json({ ok: true });
    }
    const passwordHash = await hash(d.password, ARGON);
    const user = await prisma.$transaction(async (tx) => {
      let institutionId: string | undefined;
      if (d.role === "INSTITUTION_ADMIN") {
        institutionId = (await tx.institution.create({ data: { ...d.institution } })).id;
      }
      return tx.user.create({
        data: {
          email: d.email, phone, passwordHash, role: d.role, fullName: d.fullName, institutionId, language: d.language, consentAt: new Date(),
          ...(d.role === "PARENT" && { parent: { create: { occupation: d.occupation, employer: d.employer } } }),
          ...(d.role === "STUDENT" && { student: { create: { fullName: d.fullName, dateOfBirth: new Date(0) } } }),
        },
      });
    });
    res.status(201).json({ ...(await issueTokens(user)), role: user.role, language: user.language });
  }),
);

auth.post(
  "/login",
  strict,
  body(z.object({ email: z.string().email().toLowerCase(), password: z.string(), code: z.string().regex(/^\d{6}$/).optional() })),
  h(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { email: req.body.email } });
    const fail = () => res.status(401).json({ error: "invalid_credentials" });
    if (!user || user.disabledAt) return fail();
    if (user.lockedUntil && user.lockedUntil > new Date()) return res.status(423).json({ error: "locked" });
    const bad = async () => {
      const failed = user.failedLogins + 1;
      await prisma.user.update({ where: { id: user.id }, data: { failedLogins: failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60_000) : null } });
      return fail();
    };
    if (!(await verify(user.passwordHash, req.body.password))) return bad();
    let mfa = false;
    if (user.mfaEnabled && user.mfaSecret) {
      if (!req.body.code) return res.status(401).json({ error: "mfa_required" }); // password was right; ask for the code
      if (!verifyCode(user.mfaSecret, req.body.code)) return bad(); // wrong codes count toward lockout
      mfa = true;
    }
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    res.json({ ...(await issueTokens(user, mfa)), role: user.role, language: user.language, mfaEnabled: user.mfaEnabled });
  }),
);

// Rotating refresh tokens. Presenting an already-used token revokes the entire family (theft detection).
auth.post(
  "/refresh",
  body(z.object({ refreshToken: z.string() })),
  h(async (req, res) => {
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(req.body.refreshToken) }, include: { user: true } });
    if (!row) return res.status(401).json({ error: "invalid_token" });
    if (row.revokedAt || row.expiresAt < new Date() || row.user.disabledAt) {
      await prisma.refreshToken.updateMany({ where: { family: row.family }, data: { revokedAt: new Date() } });
      return res.status(401).json({ error: "invalid_token" });
    }
    await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    res.json({ ...(await issueTokens(row.user, row.mfa, row.family)), role: row.user.role, language: row.user.language, mfaEnabled: row.user.mfaEnabled });
  }),
);

auth.post(
  "/logout",
  body(z.object({ refreshToken: z.string() })),
  h(async (req, res) => {
    await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(req.body.refreshToken) }, data: { revokedAt: new Date() } });
    res.status(204).end();
  }),
);

// ---- profile & language
auth.get("/me", authenticate, h(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
  res.json({ id: u.id, email: u.email, fullName: u.fullName, role: u.role, language: u.language, mfaEnabled: u.mfaEnabled, mfa: !!req.user!.mfa, institutionId: u.institutionId });
}));

auth.patch("/me", authenticate, body(z.object({ language: z.enum(["en", "ny", "tum"]) })), h(async (req, res) => {
  await prisma.user.update({ where: { id: req.user!.sub }, data: { language: req.body.language } });
  res.json({ ok: true });
}));

// ---- TOTP MFA (any authenticator app). Setup is pending until a valid code proves the app works.
auth.post("/mfa/setup", authenticate, h(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
  if (u.mfaEnabled) return res.status(409).json({ error: "already_enabled" });
  const s = newSecret(u.email);
  await prisma.user.update({ where: { id: u.id }, data: { mfaSecret: s.stored } });
  res.json({ secret: s.secret, otpauthUrl: s.otpauthUrl });
}));

auth.post("/mfa/enable", authenticate, body(z.object({ code: z.string().regex(/^\d{6}$/) })), h(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
  if (!u.mfaSecret || u.mfaEnabled || !verifyCode(u.mfaSecret, req.body.code)) return res.status(400).json({ error: "invalid_code" });
  await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: true } });
  await audit(req, "mfa.enable", "User", u.id);
  // Fresh session whose tokens carry mfa=true; the old (non-MFA) refresh family is revoked.
  await prisma.refreshToken.updateMany({ where: { userId: u.id }, data: { revokedAt: new Date() } });
  res.json(await issueTokens(u, true));
}));

// ---- password reset (always 202: never reveals whether an address is registered)
auth.post("/forgot", strict, body(z.object({ email: z.string().email().toLowerCase() })), h(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { email: req.body.email } });
  if (u && !u.disabledAt) {
    const token = randomToken(32);
    await prisma.passwordReset.create({ data: { userId: u.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) } });
    const link = `${process.env.WEB_URL ?? "http://localhost:3000"}/reset?token=${token}`;
    await sendEmail(u.email, "Reset your Enrolla password", `Open this link within 1 hour to choose a new password:\n${link}\n\nIf you did not ask for this, ignore this message.`);
  }
  res.status(202).json({ ok: true });
}));

auth.post("/reset", strict, body(z.object({ token: z.string().min(20), password })), h(async (req, res) => {
  const r = await prisma.passwordReset.findUnique({ where: { tokenHash: sha256(req.body.token) } });
  if (!r || r.usedAt || r.expiresAt < new Date()) return res.status(400).json({ error: "invalid_token" });
  await prisma.$transaction([
    prisma.passwordReset.update({ where: { id: r.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: r.userId }, data: { passwordHash: await hash(req.body.password, ARGON), failedLogins: 0, lockedUntil: null } }),
    prisma.refreshToken.updateMany({ where: { userId: r.userId }, data: { revokedAt: new Date() } }), // sign out everywhere
  ]);
  res.json({ ok: true });
}));

// ---- notifications (every role; clients translate by `type`)
auth.get("/notifications", authenticate, h(async (req, res) => {
  res.json(await prisma.notification.findMany({ where: { userId: req.user!.sub }, select: { id: true, type: true, data: true, readAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50 }));
}));
auth.post("/notifications/read", authenticate, h(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.sub, readAt: null }, data: { readAt: new Date() } });
  res.status(204).end();
}));
