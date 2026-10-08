// Demo data for trying the UI locally (refuses to run in production):
//   npx tsx scripts/dev-seed.ts
// Logins (password for all: Passw0rd-demo1). Owner & school admin have MFA on with the FIXED dev secret below,
// so add it to any authenticator app (or compute codes with `otpauth`).
import { hash } from "@node-rs/argon2";
import { prisma } from "../src/db.js";
import { encrypt } from "../src/lib/crypto.js";
import { localWrite } from "../src/lib/storage.js";
import { config } from "../src/config.js";
import zlib from "node:zlib";

// Small generated PNG so the demo gallery has something visible without shipping image files.
function png(w: number, h: number, px: (x: number, y: number) => [number, number, number]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = px(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

if (config.NODE_ENV === "production") throw new Error("dev-seed must not run in production");
export const DEV_MFA_SECRET = "JBSWY3DPEHPK3PXP";
const passwordHash = await hash("Passw0rd-demo1", { memoryCost: 19456, timeCost: 2, parallelism: 1 });
const verified = { phoneVerifiedAt: new Date() };
const mfa = { mfaEnabled: true, mfaSecret: encrypt(DEV_MFA_SECRET) };

const owner = await prisma.user.upsert({ where: { email: "owner@enrolla.test" }, update: {}, create: { email: "owner@enrolla.test", fullName: "Demo Owner", role: "SYSTEM_OWNER", passwordHash, ...mfa } });
if (!(await prisma.revenueConfig.count())) await prisma.revenueConfig.create({ data: { institutionCommissionBps: 3000, studentServiceFeeBps: 3000, createdById: owner.id } });
await prisma.setting.upsert({ where: { key: "pay.AIRTEL_MONEY" }, update: {}, create: { key: "pay.AIRTEL_MONEY", value: "+265999000111" } });
await prisma.setting.upsert({ where: { key: "pay.MPAMBA" }, update: {}, create: { key: "pay.MPAMBA", value: "+265888000222" } });

const inst = (await prisma.institution.findFirst({ where: { name: "Zomba Demo University" } })) ??
  (await prisma.institution.create({ data: { name: "Zomba Demo University", type: "UNIVERSITY", district: "Zomba", contactEmail: "admissions@zdu.test", status: "VERIFIED", verifiedAt: new Date() } }));
await prisma.user.upsert({ where: { email: "school@enrolla.test" }, update: {}, create: { email: "school@enrolla.test", phone: "+265888000333", fullName: "Demo Registrar", role: "INSTITUTION_ADMIN", ...verified, institutionId: inst.id, passwordHash, ...mfa } });
const prog = (await prisma.program.findFirst({ where: { institutionId: inst.id, title: "BSc Computer Science" } })) ??
  (await prisma.program.create({ data: { institutionId: inst.id, title: "BSc Computer Science", level: "Undergraduate", code: "BSCS", seats: 30, applicationFee: 1_000_000, tuitionFeeMinor: 80_000_000, tuitionPeriod: "SEMESTER", duration: "4 years", modes: ["FULL_TIME", "WEEKEND"], entryRequirements: "Six MSCE credits including English and Mathematics", status: "ACTIVE" } }));

// Make sure the demo programme shows tuition (also upgrades databases seeded before tuition existed).
await prisma.program.update({ where: { id: prog.id }, data: { tuitionFeeMinor: 80_000_000, tuitionPeriod: "SEMESTER", duration: "4 years", code: "BSCS", modes: ["FULL_TIME", "WEEKEND"], entryRequirements: "Six MSCE credits including English and Mathematics" } });
for (const [title, code, fee] of [["BA Economics", "BAEC", 75_000_000], ["Bachelor of Business Administration", "BBA", 80_000_000], ["BSc Finance and Banking", "BSFB", 85_000_000]] as const) {
  if (!(await prisma.program.findFirst({ where: { institutionId: inst.id, title } })))
    await prisma.program.create({ data: { institutionId: inst.id, title, level: "Undergraduate", code, seats: 30, applicationFee: 1_000_000, tuitionFeeMinor: fee, tuitionPeriod: "SEMESTER", duration: "4 years", modes: ["FULL_TIME"], status: "ACTIVE" } });
}
await prisma.institution.update({ where: { id: inst.id }, data: { description: "A demonstration university in Zomba offering business, economics and computing degrees.", campuses: ["Zomba"], website: "https://example.com", otherFees: [{ name: "Registration", amountMinor: 5_500_000, period: "SEMESTER" }, { name: "Students' Union", amountMinor: 500_000, period: "SEMESTER" }] } });
if (!(await prisma.media.count({ where: { institutionId: inst.id } }))) {
  const a = `inst/${inst.id}/media/demo-library`, b = `inst/${inst.id}/media/demo-lab`;
  await localWrite(a, png(640, 420, (x, y) => [20 + (x >> 3), 60 + (y >> 3), 140 + ((x + y) >> 5)]), "image/png");
  await localWrite(b, png(640, 420, (x, y) => [180 - (y >> 3), 120 + (x >> 4), 60]), "image/png");
  await prisma.media.createMany({ data: [{ institutionId: inst.id, kind: "IMAGE", caption: "Main library", storageKey: a, approved: true }, { institutionId: inst.id, kind: "IMAGE", caption: "Computer lab (awaiting approval)", storageKey: b, approved: false }] });
}
let primary = await prisma.institution.findFirst({ where: { name: "Zomba Demo Primary School" } });
if (!primary) primary = await prisma.institution.create({ data: { name: "Zomba Demo Primary School", type: "PRIMARY_SCHOOL", district: "Zomba", contactEmail: "office@zdp.test", status: "VERIFIED", verifiedAt: new Date(), highestLevel: "STD8", description: "Standard 1 to Standard 8." } });
for (const l of ["STD1", "STD4", "STD8"]) {
  if (!(await prisma.program.findFirst({ where: { institutionId: primary.id, classLevel: l } })))
    await prisma.program.create({ data: { institutionId: primary.id, title: `Standard ${l.slice(3)}`, level: `Standard ${l.slice(3)}`, classLevel: l, seats: 60, applicationFee: 300_000, tuitionFeeMinor: 4_500_000, tuitionPeriod: "TERM", status: "ACTIVE" } });
}

const sUser = await prisma.user.upsert({ where: { email: "student@enrolla.test" }, update: {}, create: { email: "student@enrolla.test", fullName: "Chikondi Banda", role: "STUDENT", language: "ny", passwordHash, phone: "+265999123456", ...verified, student: { create: { fullName: "Chikondi Banda", dateOfBirth: new Date("2006-03-04") } } }, include: { student: true } });
const student = sUser.student ?? (await prisma.student.findFirstOrThrow({ where: { userId: sUser.id } }));
let cred = await prisma.credential.findFirst({ where: { studentId: student.id } });
const DEMO_FORM = {
  personal: { surname: "Banda", firstName: "Chikondi", gender: "M", dateOfBirth: "2006-03-04", nationality: "Malawian", nationalId: "DEMO1234", homeDistrict: "Zomba", traditionalAuthority: "Mlumbe", village: "Chinamwali", physicalAddress: "Area 3, Zomba", phone: "0999123456" },
  specialNeeds: { hasDisability: false },
  education: { level: "MSCE", schoolName: "Zomba Secondary School", year: 2024, subjects: [{ subject: "English", grade: "2" }, { subject: "Mathematics", grade: "3" }, { subject: "Physics", grade: "3" }] },
  status: { current: "STUDYING" }, guardian: { relationship: "PARENT", name: "Mayi Banda", phone: "0888111222" },
  study: { mode: "FULL_TIME" }, sponsor: { type: "PARENT", name: "Mayi Banda" }, heardAbout: { channels: ["FRIEND"] }, declaration: { accepted: true, signatureName: "Chikondi Banda" },
};
const demoPdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
if (!cred) {
  cred = await prisma.credential.create({ data: { studentId: student.id, kind: "MSCE", title: "MSCE Certificate 2024", storageKey: `students/${student.id}/creds/demo-msce`, sha256: "0".repeat(64), mime: "application/pdf" } });
}
await localWrite(cred.storageKey, demoPdf, "application/pdf"); // always (re)write so the file exists in whichever LOCAL_STORAGE_DIR is in use
if (!(await prisma.application.findFirst({ where: { studentId: student.id } }))) {
  const a = await prisma.application.create({ data: { studentId: student.id, institutionId: inst.id, programId: prog.id, choices: { create: [{ programId: prog.id, rank: 1 }] }, status: "SUBMITTED", form: DEMO_FORM, statement: "I want to study computing to build tools for farmers.", attachedCredentialIds: [cred.id], feeMinor: 1_000_000, studentServiceFeeMinor: 300_000, commissionMinor: 300_000, totalDueMinor: 1_300_000 } });
  await prisma.payment.create({ data: { applicationId: a.id, provider: "MPAMBA", reference: "DEMO0001XYZ", payerPhone: "+265881000000", amountMinor: 1_300_000, status: "CONFIRMED", confirmedAt: new Date() } });
}
console.log("seeded. owner@enrolla.test / school@enrolla.test / student@enrolla.test  password Passw0rd-demo1  MFA secret", DEV_MFA_SECRET);
await prisma.$disconnect();
