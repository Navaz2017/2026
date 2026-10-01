import { Router } from "express";
import { z } from "zod";
import { hash, verify } from "@node-rs/argon2";
import { prisma } from "../db.js";
import { body, h } from "../middleware/validate.js";
import { signAccess } from "../middleware/auth.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { normalisePhone } from "../lib/phone.js";

export const auth = Router();

const password = z.string().min(10).max(128);
const base = { email: z.string().email().toLowerCase(), password, fullName: z.string().min(2).max(120), phone: z.string().optional() };

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

async function issueTokens(user: { id: string; role: any; institutionId: string | null }, family = randomToken(16)) {
  const refresh = randomToken();
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: sha256(refresh), family, expiresAt: new Date(Date.now() + REFRESH_DAYS * 864e5) },
  });
  return { accessToken: signAccess({ sub: user.id, role: user.role, inst: user.institutionId ?? undefined }), refreshToken: refresh };
}

auth.post(
  "/signup",
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
          email: d.email, phone, passwordHash, role: d.role, fullName: d.fullName, institutionId,
          ...(d.role === "PARENT" && { parent: { create: { occupation: d.occupation, employer: d.employer } } }),
          ...(d.role === "STUDENT" && { student: { create: { fullName: d.fullName, dateOfBirth: new Date(0) } } }),
        },
      });
    });
    res.status(201).json(await issueTokens(user));
  }),
);

auth.post(
  "/login",
  body(z.object({ email: z.string().email().toLowerCase(), password: z.string() })),
  h(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { email: req.body.email } });
    const fail = () => res.status(401).json({ error: "invalid_credentials" });
    if (!user || user.disabledAt) return fail();
    if (user.lockedUntil && user.lockedUntil > new Date()) return res.status(423).json({ error: "locked" });
    if (!(await verify(user.passwordHash, req.body.password))) {
      const failed = user.failedLogins + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60_000) : null },
      });
      return fail();
    }
    // TODO(mfa): SYSTEM_OWNER and INSTITUTION_ADMIN must pass TOTP here before tokens are issued.
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    res.json({ ...(await issueTokens(user)), role: user.role });
  }),
);

// Rotating refresh tokens. Presenting an already-used token revokes the entire family (theft detection).
auth.post(
  "/refresh",
  body(z.object({ refreshToken: z.string() })),
  h(async (req, res) => {
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(req.body.refreshToken) }, include: { user: true } });
    if (!row) return res.status(401).json({ error: "invalid_token" });
    if (row.revokedAt || row.expiresAt < new Date()) {
      await prisma.refreshToken.updateMany({ where: { family: row.family }, data: { revokedAt: new Date() } });
      return res.status(401).json({ error: "invalid_token" });
    }
    await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    res.json(await issueTokens(row.user, row.family));
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

