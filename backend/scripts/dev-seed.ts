// Demo data for trying the UI locally (refuses to run in production):
//   npx tsx scripts/dev-seed.ts
// Logins (password for all: Passw0rd-demo1). Owner & school admin have MFA on with the FIXED dev secret below,
// so add it to any authenticator app (or compute codes with `otpauth`).
import { hash } from "@node-rs/argon2";
import { prisma } from "../src/db.js";
import { encrypt } from "../src/lib/crypto.js";
import { localWrite } from "../src/lib/storage.js";
import { config } from "../src/config.js";

if (config.NODE_ENV === "production") throw new Error("dev-seed must not run in production");
export const DEV_MFA_SECRET = "JBSWY3DPEHPK3PXP";
const passwordHash = await hash("Passw0rd-demo1", { memoryCost: 19456, timeCost: 2, parallelism: 1 });
const mfa = { mfaEnabled: true, mfaSecret: encrypt(DEV_MFA_SECRET) };

const owner = await prisma.user.upsert({ where: { email: "owner@enrolla.test" }, update: {}, create: { email: "owner@enrolla.test", fullName: "Demo Owner", role: "SYSTEM_OWNER", passwordHash, ...mfa } });
if (!(await prisma.revenueConfig.count())) await prisma.revenueConfig.create({ data: { institutionCommissionBps: 3000, studentServiceFeeBps: 3000, createdById: owner.id } });
await prisma.setting.upsert({ where: { key: "pay.AIRTEL_MONEY" }, update: {}, create: { key: "pay.AIRTEL_MONEY", value: "+265999000111" } });
await prisma.setting.upsert({ where: { key: "pay.MPAMBA" }, update: {}, create: { key: "pay.MPAMBA", value: "+265888000222" } });

const inst = (await prisma.institution.findFirst({ where: { name: "Zomba Demo University" } })) ??
  (await prisma.institution.create({ data: { name: "Zomba Demo University", type: "UNIVERSITY", district: "Zomba", contactEmail: "admissions@zdu.test", status: "VERIFIED", verifiedAt: new Date() } }));
await prisma.user.upsert({ where: { email: "school@enrolla.test" }, update: {}, create: { email: "school@enrolla.test", fullName: "Demo Registrar", role: "INSTITUTION_ADMIN", institutionId: inst.id, passwordHash, ...mfa } });
const prog = (await prisma.program.findFirst({ where: { institutionId: inst.id } })) ??
  (await prisma.program.create({ data: { institutionId: inst.id, title: "BSc Computer Science", level: "Undergraduate", seats: 30, applicationFee: 1_000_000, status: "ACTIVE" } }));

const sUser = await prisma.user.upsert({ where: { email: "student@enrolla.test" }, update: {}, create: { email: "student@enrolla.test", fullName: "Chikondi Banda", role: "STUDENT", language: "ny", passwordHash, phone: "+265999123456", student: { create: { fullName: "Chikondi Banda", dateOfBirth: new Date("2006-03-04") } } }, include: { student: true } });
const student = sUser.student ?? (await prisma.student.findFirstOrThrow({ where: { userId: sUser.id } }));
let cred = await prisma.credential.findFirst({ where: { studentId: student.id } });
const demoPdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
if (!cred) {
  cred = await prisma.credential.create({ data: { studentId: student.id, kind: "MSCE", title: "MSCE Certificate 2024", storageKey: `students/${student.id}/creds/demo-msce`, sha256: "0".repeat(64), mime: "application/pdf" } });
}
await localWrite(cred.storageKey, demoPdf, "application/pdf"); // always (re)write so the file exists in whichever LOCAL_STORAGE_DIR is in use
if (!(await prisma.application.findFirst({ where: { studentId: student.id } }))) {
  const a = await prisma.application.create({ data: { studentId: student.id, programId: prog.id, status: "SUBMITTED", statement: "I want to study computing to build tools for farmers.", attachedCredentialIds: [cred.id], feeMinor: 1_000_000, studentServiceFeeMinor: 300_000, commissionMinor: 300_000, totalDueMinor: 1_300_000 } });
  await prisma.payment.create({ data: { applicationId: a.id, provider: "MPAMBA", reference: "DEMO0001XYZ", payerPhone: "+265881000000", amountMinor: 1_300_000, status: "CONFIRMED", confirmedAt: new Date() } });
}
console.log("seeded. owner@enrolla.test / school@enrolla.test / student@enrolla.test  password Passw0rd-demo1  MFA secret", DEV_MFA_SECRET);
await prisma.$disconnect();
