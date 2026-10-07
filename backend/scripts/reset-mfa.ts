// For the person who runs the server (physical/SSH access): turn off two-step security for one account,
// e.g. the owner who lost their phone AND their recovery codes. They then sign in with the password and set it up again.
//   npm run reset-mfa -- someone@example.com
import { prisma } from "../src/db.js";

const email = process.argv[2]?.toLowerCase();
if (!email) { console.error("usage: npm run reset-mfa -- <email>"); process.exit(1); }
const u = await prisma.user.findUnique({ where: { email } });
if (!u) { console.error("no such user"); process.exit(1); }
await prisma.$transaction([
  prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: false, mfaSecret: null } }),
  prisma.mfaRecoveryCode.deleteMany({ where: { userId: u.id } }),
  prisma.refreshToken.updateMany({ where: { userId: u.id }, data: { revokedAt: new Date() } }),
  prisma.auditLog.create({ data: { actorId: null, action: "user.reset_mfa.cli", entity: "User", entityId: u.id } }),
]);
console.log(`Two-step security turned off for ${email}. They must sign in and set it up again.`);
await prisma.$disconnect();
