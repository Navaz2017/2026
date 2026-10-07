import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { prisma } from "../../src/db.js";
import { app } from "../../src/app.js";
import { signAccess } from "../../src/middleware/auth.js";
import { currentCode } from "../../src/lib/totp.js";

const skip = !process.env.INTEGRATION;
let server: Server, base: string, n = 0;
before(async () => {
  if (skip) return;
  await prisma.$executeRawUnsafe(`TRUNCATE "User","Institution","Device","RevenueConfig" RESTART IDENTITY CASCADE`);
  server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { if (!skip) { server.close(); await prisma.$disconnect(); } });

const call = (method: string, path: string, token?: string, body?: unknown) =>
  fetch(`${base}/v1${path}`, { method, headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (r: Response) => r.json() as Promise<any>;
const PW = "a-long-password-1";

// A school admin who has completed two-step setup. Returns what the browser would hold.
async function adminWithMfa() {
  const i = ++n, email = `staff${i}@school.mw`;
  const s = await json(await call("POST", "/auth/signup", undefined, { email, password: PW, fullName: "Staff", role: "INSTITUTION_ADMIN", consent: true, institution: { name: `School ${i}`, type: "COLLEGE", contactEmail: `s${i}@x.mw` } }));
  const setup = await json(await call("POST", "/auth/mfa/setup", s.accessToken));
  const en = await json(await call("POST", "/auth/mfa/enable", s.accessToken, { code: currentCode(setup.secret) }));
  return { email, secret: setup.secret, access: en.accessToken as string, refresh: en.refreshToken as string, codes: en.recoveryCodes as string[], id: (await prisma.user.findUniqueOrThrow({ where: { email } })).id };
}
const login = (email: string, code?: string, password = PW) => call("POST", "/auth/login", undefined, { email, password, ...(code && { code }) });

test("enabling two-step security gives 8 one-time recovery codes", { skip }, async () => {
  const a = await adminWithMfa();
  assert.equal(a.codes.length, 8);
  assert.ok(a.codes.every((c) => /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(c)));
  assert.equal(new Set(a.codes).size, 8);
  const stored = await prisma.mfaRecoveryCode.findMany({ where: { userId: a.id } });
  assert.equal(stored.length, 8);
  assert.ok(!stored.some((s) => a.codes.includes(s.codeHash))); // only hashes are stored
});

test("lost phone: a recovery code signs in exactly once; wrong/other users' codes fail; usage is audited", { skip }, async () => {
  const a = await adminWithMfa(), b = await adminWithMfa();
  const ok = await login(a.email, a.codes[0]);
  assert.equal(ok.status, 200);
  const t = await json(ok);
  assert.equal((await json(await call("GET", "/auth/me", t.accessToken))).mfa, true); // counts as a two-step session
  assert.equal((await login(a.email, a.codes[0])).status, 401);                      // single use
  assert.equal((await login(a.email, b.codes[0])).status, 401);                      // someone else's code
  assert.equal((await login(a.email, "zzzz-zzzz")).status, 401);
  assert.equal((await login(a.email, a.codes[1]?.toUpperCase())).status, 200);       // case-insensitive typing
  assert.equal((await json(await call("GET", "/auth/me", t.accessToken))).recoveryCodesLeft, 6);
  assert.equal(await prisma.auditLog.count({ where: { action: "mfa.recovery_code_used", entityId: a.id } }), 2);
  assert.equal((await login(a.email, currentCode(a.secret))).status, 200);            // authenticator still works
});

test("regenerating recovery codes needs a two-step session and invalidates the old ones", { skip }, async () => {
  const a = await adminWithMfa();
  const plain = signAccess({ sub: a.id, role: "INSTITUTION_ADMIN" });                 // password-only session
  assert.equal((await call("POST", "/auth/mfa/recovery-codes", plain)).status, 403);
  const fresh = await json(await call("POST", "/auth/mfa/recovery-codes", a.access));
  assert.equal(fresh.recoveryCodes.length, 8);
  assert.equal((await login(a.email, a.codes[0])).status, 401);                       // old code dead
  assert.equal((await login(a.email, fresh.recoveryCodes[0])).status, 200);
});

test("change password: needs the current one, rejects weak/same, signs out other devices, keeps this one", { skip }, async () => {
  const a = await adminWithMfa();
  const NEW = "brand-new-password-9";
  assert.equal((await call("POST", "/auth/change-password", a.access, { currentPassword: "wrong-wrong-1", newPassword: NEW })).status, 400);
  assert.equal((await call("POST", "/auth/change-password", a.access, { currentPassword: PW, newPassword: PW })).status, 400);
  assert.equal((await call("POST", "/auth/change-password", a.access, { currentPassword: PW, newPassword: "short" })).status, 400);
  assert.equal((await call("POST", "/auth/change-password")).status, 401);
  const other = await json(await login(a.email, currentCode(a.secret)));              // a second device
  const r = await call("POST", "/auth/change-password", a.access, { currentPassword: PW, newPassword: NEW });
  assert.equal(r.status, 200);
  const t = await json(r);
  assert.equal((await json(await call("GET", "/auth/me", t.accessToken))).mfa, true); // this device keeps its two-step session
  assert.equal((await call("POST", "/auth/refresh", undefined, { refreshToken: other.refreshToken })).status, 401); // other device signed out
  assert.equal((await call("POST", "/auth/refresh", undefined, { refreshToken: t.refreshToken })).status, 200);
  assert.equal((await login(a.email, currentCode(a.secret), PW)).status, 401);
  assert.equal((await login(a.email, currentCode(a.secret), NEW)).status, 200);
  assert.equal(await prisma.auditLog.count({ where: { action: "password.change", entityId: a.id } }), 1);
});

test("owner can reset a staff member's two-step security; staff then sign in with password only", { skip }, async () => {
  const a = await adminWithMfa();
  const owner = await prisma.user.create({ data: { email: `own${++n}@x.mw`, passwordHash: "x", role: "SYSTEM_OWNER", fullName: "O" } });
  const ot = signAccess({ sub: owner.id, role: "SYSTEM_OWNER", mfa: true });
  assert.equal((await call("POST", `/admin/users/${a.id}/reset-mfa`, a.access)).status, 403);        // not an owner
  assert.equal((await call("POST", `/admin/users/${owner.id}/reset-mfa`, ot)).status, 400);          // not yourself
  assert.equal((await call("POST", `/admin/users/${a.id}/reset-mfa`, ot)).status, 204);
  assert.equal((await login(a.email)).status, 200);                                                   // password alone works now
  const row = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
  assert.deepEqual([row.mfaEnabled, row.mfaSecret], [false, null]);
  assert.equal(await prisma.mfaRecoveryCode.count({ where: { userId: a.id } }), 0);
  assert.equal((await call("POST", "/auth/refresh", undefined, { refreshToken: a.refresh })).status, 401); // old sessions revoked
  assert.equal(await prisma.auditLog.count({ where: { action: "user.reset_mfa", entityId: a.id } }), 1);
});
