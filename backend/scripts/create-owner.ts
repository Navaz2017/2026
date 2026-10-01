// One-off bootstrap: OWNER_EMAIL=you@x.com OWNER_PASSWORD='...' npx tsx scripts/create-owner.ts
// Creates the SYSTEM_OWNER (cannot be self-registered via the API) and the default 30% / 30% revenue config.
import { hash } from "@node-rs/argon2";
import { prisma } from "../src/db.js";

const { OWNER_EMAIL, OWNER_PASSWORD } = process.env;
if (!OWNER_EMAIL || !OWNER_PASSWORD || OWNER_PASSWORD.length < 12) { console.error("OWNER_EMAIL and OWNER_PASSWORD (12+ chars) required"); process.exit(1); }
const owner = await prisma.user.upsert({
  where: { email: OWNER_EMAIL.toLowerCase() }, update: {},
  create: { email: OWNER_EMAIL.toLowerCase(), fullName: "System Owner", role: "SYSTEM_OWNER", passwordHash: await hash(OWNER_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 }) },
});
if (!(await prisma.revenueConfig.count())) await prisma.revenueConfig.create({ data: { institutionCommissionBps: 3000, studentServiceFeeBps: 3000, createdById: owner.id } });
console.log("owner ready:", owner.email);
await prisma.$disconnect();
