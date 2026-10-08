import { Router } from "express";
import rateLimit from "express-rate-limit";
import { config } from "../config.js";
import { z } from "zod";
import { hash, verify } from "@node-rs/argon2";
import { prisma } from "../db.js";
import { body, h } from "../middleware/validate.js";
import { authenticate, requireMfa, signAccess } from "../middleware/auth.js";
import crypto from "node:crypto";
import { randomToken, sha256 } from "../lib/crypto.js";
import { normalisePhone } from "../lib/phone.js";
import { newSecret, verifyCode } from "../lib/totp.js";
import { sendEmail } from "../lib/mailer.js";
import { audit } from "../lib/audit.js";
import { OtpError, checkOtp, sendOtp } from "../lib/otp.js";

export const auth = Router();

// Brute-force protection for credential endpoints only, per client IP (the web app forwards the real client IP).
// /auth/me, /refresh, notifications etc. are normal authenticated traffic and use the general per-user limiter.
const strict = rateLimit({ windowMs: 15 * 60_000, limit: config.NODE_ENV === "test" ? 10_000 : 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ip:${req.ip}` });

const password = z.string().min(10).max(128);
const language = z.enum(["en", "ny", "tum"]).default("en");
const base = {
  password, fullName: z.string().min(2).max(120), phone: z.string().min(6).max(20), // verified by a one-time code right after signup
  language,
  consent: z.literal(true), // data-protection consent is mandatory (children's data)
};

// Self-service signup is limited to roles that are safe to self-register. SYSTEM_OWNER is never creatable here.
const signup = z.discriminatedUnion("role", [
  z.object({ ...base, email: z.string().email().toLowerCase().optional(), role: z.literal("PARENT"), occupation: z.string().min(2).max(120), employer: z.string().max(120).optional() }),
  z.object({ ...base, email: z.string().email().toLowerCase().optional(), role: z.literal("STUDENT") }),
  z.object({
    ...base,
    email: z.string().email().toLowerCase(), // school admins need an address for records and letters
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

// 8 single-use codes like "k3f9-a7qm". Only hashes are stored.
const RECOVERY_RE = /^[a-z0-9]{4}-[a-z0-9]{4}$/i;
const normaliseRecovery = (c: string) => c.trim().toLowerCase();
async function newRecoveryCodes(userId: string) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alike characters (0/o, 1/l/i)
  const codes = Array.from({ length: 8 }, () => { const b = crypto.randomBytes(8); const c = Array.from(b, (x) => alphabet[x % alphabet.length]).join(""); return `${c.slice(0, 4)}-${c.slice(4)}`; });
  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    prisma.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: sha256(c) })) }),
  ]);
  return codes;
}

type TokenUser = { id: string; role: any; institutionId: string | null };
async function issueTokens(user: TokenUser, mfa = false, family = randomToken(16)) {
  const refresh = randomToken();
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: sha256(refresh), family, mfa, expiresAt: new Date(Date.now() + REFRESH_DAYS * 864e5) },
  });
  return { accessToken: signAccess({ sub: user.id, role: user.role, inst: user.institutionId ?? undefined, mfa }), refreshToken: refresh };
}

// Sign in with an email address or a phone number (0999…, +265999…).
async function findByIdentifier(raw: string) {
  const id = raw.trim();
  if (id.includes("@")) return prisma.user.findUnique({ where: { email: id.toLowerCase() } });
  const phone = normalisePhone(id);
  return phone ? prisma.user.findUnique({ where: { phone } }) : null;
}

auth.post(
  "/signup",
  strict,
  body(signup),
  h(async (req, res) => {
    const d = req.body as z.infer<typeof signup>;
    const phone = normalisePhone(d.phone);
    if (!phone) return res.status(400).json({ error: "invalid_phone" });
    const email = d.email ?? null;
    if (await prisma.user.findFirst({ where: { OR: [{ phone }, ...(email ? [{ email }] : [])] }, select: { id: true } })) {
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
          email, phone, passwordHash, role: d.role, fullName: d.fullName, institutionId, language: d.language, consentAt: new Date(),
          ...(d.role === "PARENT" && { parent: { create: { occupation: d.occupation, employer: d.employer } } }),
          ...(d.role === "STUDENT" && { student: { create: { fullName: d.fullName, dateOfBirth: new Date(0) } } }),
        },
      });
    });
    // First code goes out immediately. A delivery problem must not undo the signup: the app offers "send again".
    const verification = await sendOtp({ phone: phone, purpose: "SIGNUP", userId: user.id, language: user.language }).catch((e) => ({ error: e instanceof OtpError ? e.code : "otp_failed" }));
    res.status(201).json({ ...(await issueTokens(user)), role: user.role, language: user.language, phoneVerified: false, verification });
  }),
);

auth.post(
  "/login",
  strict,
  body(z.object({ identifier: z.string().min(3).max(254).optional(), email: z.string().max(254).optional(), password: z.string(), code: z.string().regex(/^(\d{6}|[A-Za-z0-9]{4}-[A-Za-z0-9]{4})$/).optional() }).refine((b) => b.identifier || b.email)),
  h(async (req, res) => {
    const user = await findByIdentifier(req.body.identifier ?? req.body.email);
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
      if (RECOVERY_RE.test(req.body.code)) {
        // lost phone: a recovery code works exactly once
        const used = await prisma.mfaRecoveryCode.updateMany({ where: { userId: user.id, codeHash: sha256(normaliseRecovery(req.body.code)), usedAt: null }, data: { usedAt: new Date() } });
        if (used.count !== 1) return bad();
        await prisma.auditLog.create({ data: { actorId: user.id, action: "mfa.recovery_code_used", entity: "User", entityId: user.id, ip: req.ip } });
      } else if (!verifyCode(user.mfaSecret, req.body.code)) return bad(); // wrong codes count toward lockout
      mfa = true;
    }
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    res.json({ ...(await issueTokens(user, mfa)), role: user.role, language: user.language, mfaEnabled: user.mfaEnabled, phoneVerified: !!user.phoneVerifiedAt || !user.phone });
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
    res.json({ ...(await issueTokens(row.user, row.mfa, row.family)), role: row.user.role, language: row.user.language, mfaEnabled: row.user.mfaEnabled, phoneVerified: !!row.user.phoneVerifiedAt || !row.user.phone });
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
  const recoveryCodesLeft = u.mfaEnabled ? await prisma.mfaRecoveryCode.count({ where: { userId: u.id, usedAt: null } }) : 0;
  res.json({ id: u.id, email: u.email, phone: u.phone, phoneVerified: !!u.phoneVerifiedAt || !u.phone, fullName: u.fullName, role: u.role, language: u.language, mfaEnabled: u.mfaEnabled, mfa: !!req.user!.mfa, institutionId: u.institutionId, recoveryCodesLeft });
}));

auth.patch("/me", authenticate, body(z.object({ language: z.enum(["en", "ny", "tum"]) })), h(async (req, res) => {
  await prisma.user.update({ where: { id: req.user!.sub }, data: { language: req.body.language } });
  res.json({ ok: true });
}));

// ---- TOTP MFA (any authenticator app). Setup is pending until a valid code proves the app works.
auth.post("/mfa/setup", authenticate, h(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
  if (u.mfaEnabled) return res.status(409).json({ error: "already_enabled" });
  const s = newSecret(u.email ?? u.phone ?? u.id);
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
  res.json({ ...(await issueTokens(u, true)), recoveryCodes: await newRecoveryCodes(u.id) }); // shown once
}));

// ---- password reset (always 202: never reveals whether an account exists)
// Email address -> link by email. Phone number -> one-time code over WhatsApp/SMS, finished with /reset-phone.
auth.post("/forgot", strict, body(z.object({ identifier: z.string().min(3).max(254).optional(), email: z.string().max(254).optional() }).refine((b) => b.identifier || b.email)), h(async (req, res) => {
  const raw = (req.body.identifier ?? req.body.email) as string;
  const u = await findByIdentifier(raw);
  let devCode: string | undefined;
  if (u && !u.disabledAt) {
    if (raw.includes("@") && u.email) {
      const token = randomToken(32);
      await prisma.passwordReset.create({ data: { userId: u.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) } });
      const link = `${config.WEB_URL}/reset?token=${token}`;
      await sendEmail(u.email, "Reset your Enrolla password", `Open this link within 1 hour to choose a new password:\n${link}\n\nIf you did not ask for this, ignore this message.`);
    } else if (u.phone) {
      const r = await sendOtp({ phone: u.phone, purpose: "RESET", userId: u.id, language: u.language }).catch(() => null); // errors must not reveal the account
      devCode = (r as { devCode?: string } | null)?.devCode; // only ever set outside production
    }
  }
  res.status(202).json({ ok: true, ...(devCode && { devCode }) });
}));

auth.post("/reset-phone", strict, body(z.object({ phone: z.string().min(6).max(20), code: z.string().regex(/^\d{6}$/), password })), h(async (req, res) => {
  const phone = normalisePhone(req.body.phone);
  const u = phone ? await prisma.user.findUnique({ where: { phone } }) : null;
  if (!phone || !u || u.disabledAt || !(await checkOtp(phone, "RESET", req.body.code))) return res.status(400).json({ error: "invalid_code" });
  await prisma.$transaction([
    prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hash(req.body.password, ARGON), failedLogins: 0, lockedUntil: null, phoneVerifiedAt: u.phoneVerifiedAt ?? new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: u.id }, data: { revokedAt: new Date() } }),
  ]);
  res.json({ ok: true });
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

// ---- phone verification (signed in, number not yet verified)
const otpFail = (res: any, e: unknown) => {
  if (e instanceof OtpError) return res.status(e.status).json({ error: e.code, ...(e.retryAfter && { retryAfter: e.retryAfter }) });
  throw e;
};
auth.post("/phone/send", authenticate, h(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
  if (!u.phone) return res.status(400).json({ error: "no_phone" });
  if (u.phoneVerifiedAt) return res.status(409).json({ error: "already_verified" });
  try { res.json(await sendOtp({ phone: u.phone, purpose: "SIGNUP", userId: u.id, language: u.language })); } catch (e) { otpFail(res, e); }
}));
auth.post("/phone/verify", authenticate, strict, body(z.object({ code: z.string().regex(/^\d{6}$/) })), h(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
  if (!u.phone) return res.status(400).json({ error: "no_phone" });
  if (!u.phoneVerifiedAt && !(await checkOtp(u.phone, "SIGNUP", req.body.code))) return res.status(400).json({ error: "invalid_code" });
  if (!u.phoneVerifiedAt) await prisma.user.update({ where: { id: u.id }, data: { phoneVerifiedAt: new Date() } });
  res.json({ ok: true, phoneVerified: true });
}));
// Typo in the number? Allowed only until it is verified.
auth.patch("/phone", authenticate, strict, body(z.object({ phone: z.string().min(6).max(20) })), h(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
  if (u.phoneVerifiedAt) return res.status(409).json({ error: "already_verified" });
  const phone = normalisePhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: "invalid_phone" });
  if (await prisma.user.findFirst({ where: { phone, id: { not: u.id } }, select: { id: true } })) return res.status(409).json({ error: "phone_taken" });
  await prisma.user.update({ where: { id: u.id }, data: { phone } });
  try { res.json(await sendOtp({ phone, purpose: "SIGNUP", userId: u.id, language: u.language })); } catch (e) { otpFail(res, e); }
}));

// ---- notifications (every role; clients translate by `type`)
auth.get("/notifications", authenticate, h(async (req, res) => {
  res.json(await prisma.notification.findMany({ where: { userId: req.user!.sub }, select: { id: true, type: true, data: true, readAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50 }));
}));
auth.post("/notifications/read", authenticate, h(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.sub, readAt: null }, data: { readAt: new Date() } });
  res.status(204).end();
}));

// New recovery codes (replaces any unused ones). Needs a session that already passed the authenticator check.
auth.post("/mfa/recovery-codes", authenticate, requireMfa, h(async (req, res) => {
  await audit(req, "mfa.recovery_codes_regenerated", "User", req.user!.sub);
  res.json({ recoveryCodes: await newRecoveryCodes(req.user!.sub) });
}));

// Change password while signed in. Signs out every other device.
auth.post("/change-password", authenticate, strict, body(z.object({ currentPassword: z.string().min(1), newPassword: password })), h(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
  if (!(await verify(u.passwordHash, req.body.currentPassword))) return res.status(400).json({ error: "wrong_password" });
  if (req.body.currentPassword === req.body.newPassword) return res.status(400).json({ error: "same_password" });
  await prisma.$transaction([
    prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hash(req.body.newPassword, ARGON) } }),
    prisma.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(req, "password.change", "User", u.id);
  res.json(await issueTokens(u, !!req.user!.mfa)); // this device stays signed in
}));
