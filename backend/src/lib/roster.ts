import { prisma } from "../db.js";
import { parseCsv, csvCell } from "./csv.js";
import { normalisePhone } from "./phone.js";
import { linkGuardianships } from "./schoolAccess.js";

// Roster import = how an existing school brings its students in. CSV in, preview with every problem, then commit (and rollback).
export const ROSTER_HEADERS = ["admission_no", "student_name", "date_of_birth", "gender", "class", "guardian1_name", "guardian1_phone", "guardian1_relationship", "guardian2_name", "guardian2_phone", "guardian2_relationship"];
export const rosterTemplate = () => [
  ROSTER_HEADERS.join(","),
  ["MSS/2026/001", "Chikondi Banda", "2010-03-25", "M", "Form 1A", "Mayi Banda", "0999123456", "Mother", "Bambo Banda", "0888123456", "Father"],
  ["MSS/2026/002", "Tadala Phiri", "2009-11-02", "F", "Form 3B", "Mrs Phiri", "0881555222", "Guardian", "", "", ""],
].map((r) => (Array.isArray(r) ? r.map(csvCell).join(",") : r)).join("\r\n") + "\r\n";

export interface RosterRow { line: number; admissionNo: string; name: string; dob: string; gender: "M" | "F" | null; className: string; level: string; guardians: { name: string; phone: string; relationship: string }[] }
export interface Problem { line: number; message: string }

export function parseClass(raw: string): { name: string; level: string } | null {
  const t = raw.trim().replace(/\s+/g, " ");
  let m = /^(?:form|f)\.?\s*([1-6])\s*([A-Za-z0-9]{0,3})$/i.exec(t);
  if (m) return { name: `Form ${m[1]}${m[2]!.toUpperCase()}`, level: `F${m[1]}` };
  m = /^(?:standard|std)\.?\s*([1-8])\s*([A-Za-z0-9]{0,3})$/i.exec(t);
  if (m) return { name: `Standard ${m[1]}${m[2]!.toUpperCase()}`, level: `STD${m[1]}` };
  return null;
}
const relOf = (raw: string) => (/guardian|aunt|uncle|grand|sister|brother|other/i.test(raw) ? "GUARDIAN" : /kin/i.test(raw) ? "NEXT_OF_KIN" : "PARENT");

export function parseRoster(csv: string, instType: "PRIMARY_SCHOOL" | "SECONDARY_SCHOOL") {
  const { headers, rows } = parseCsv(csv);
  const errors: Problem[] = [], warnings: Problem[] = [], ok: RosterRow[] = [];
  const missingCols = ["admission_no", "student_name", "date_of_birth", "class"].filter((h) => !headers.includes(h));
  if (missingCols.length) return { rows: ok, errors: [{ line: 1, message: `Missing column(s): ${missingCols.join(", ")}. Download the template.` }], warnings };
  const seen = new Map<string, number>();
  rows.forEach((r, idx) => {
    const line = idx + 2; // header is line 1
    const bad = (message: string) => errors.push({ line, message });
    const admissionNo = (r.admission_no ?? "").trim();
    if (!admissionNo || admissionNo.length > 40) return bad("admission_no is required (max 40 characters)");
    if (seen.has(admissionNo)) return bad(`admission_no ${admissionNo} appears twice (also on line ${seen.get(admissionNo)})`);
    seen.set(admissionNo, line);
    const name = (r.student_name ?? "").trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 120) return bad("student_name is required");
    const dobD = new Date(`${r.date_of_birth}T00:00:00Z`);
    const age = (Date.now() - dobD.getTime()) / 31_557_600_000;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date_of_birth ?? "") || isNaN(dobD.getTime())) return bad("date_of_birth must look like 2010-03-25 (year-month-day)");
    if (age < 3 || age > 30) return bad(`date_of_birth ${r.date_of_birth} gives an age of ${Math.floor(age)}: please check`);
    const cls = parseClass(r.class ?? "");
    if (!cls) return bad(`class "${r.class}" not recognised: write e.g. "Form 3A" or "Standard 5B"`);
    if ((instType === "SECONDARY_SCHOOL") !== cls.level.startsWith("F")) return bad(`class ${cls.name} does not match a ${instType === "SECONDARY_SCHOOL" ? "secondary" : "primary"} school`);
    const g = (r.gender ?? "").trim().toUpperCase()[0];
    const gender = g === "M" || g === "F" ? (g as "M" | "F") : null;
    if (r.gender && !gender) warnings.push({ line, message: `gender "${r.gender}" ignored (use M or F)` });
    const guardians: RosterRow["guardians"] = [];
    for (const n of ["1", "2"]) {
      const phoneRaw = (r[`guardian${n}_phone`] ?? "").trim();
      if (!phoneRaw) continue;
      const phone = normalisePhone(phoneRaw);
      if (!phone) { warnings.push({ line, message: `guardian${n}_phone "${phoneRaw}" is not a valid Malawi number: this guardian was skipped` }); continue; }
      if (guardians.some((x) => x.phone === phone)) continue;
      guardians.push({ name: (r[`guardian${n}_name`] ?? "").trim() || "Guardian", phone, relationship: relOf(r[`guardian${n}_relationship`] ?? "") });
    }
    if (!guardians.length) warnings.push({ line, message: `${name}: no valid guardian phone, so nobody will be linked to this child yet` });
    ok.push({ line, admissionNo, name, dob: r.date_of_birth!, gender, className: cls.name, level: cls.level, guardians });
  });
  return { rows: ok, errors, warnings };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
async function findExistingStudent(tx: Tx, name: string, dob: Date, phones: string[]) {
  if (!phones.length) return null;
  const cands = await tx.student.findMany({ where: { dateOfBirth: dob, fullName: { equals: name, mode: "insensitive" } }, include: { guardianships: { select: { phone: true } }, parent: { include: { user: { select: { phone: true } } } }, user: { select: { phone: true } } } });
  return cands.find((c) => phones.some((p) => c.guardianships.some((g) => g.phone === p) || c.parent?.user.phone === p || c.user?.phone === p)) ?? null;
}

export async function commitRoster(importId: string) {
  const imp = await prisma.rosterImport.findUniqueOrThrow({ where: { id: importId } });
  const rows = imp.rows as unknown as RosterRow[];
  const stats = { newStudents: 0, matchedStudents: 0, updated: 0, guardiansLinked: 0, createdStudentIds: [] as string[], createdClassIds: [] as string[] };
  const phones = new Set<string>();
  await prisma.$transaction(async (tx) => {
    const classes = new Map<string, string>();
    for (const r of rows) {
      let classId = classes.get(r.className);
      if (!classId) {
        const found = await tx.schoolClass.findUnique({ where: { institutionId_academicYear_name: { institutionId: imp.institutionId, academicYear: imp.academicYear, name: r.className } } });
        classId = found?.id ?? (await tx.schoolClass.create({ data: { institutionId: imp.institutionId, academicYear: imp.academicYear, name: r.className, level: r.level } })).id;
        if (!found) stats.createdClassIds.push(classId);
        classes.set(r.className, classId);
      }
      const dob = new Date(`${r.dob}T00:00:00Z`);
      let enrol = await tx.enrolment.findUnique({ where: { institutionId_academicYear_admissionNo: { institutionId: imp.institutionId, academicYear: imp.academicYear, admissionNo: r.admissionNo } } });
      let studentId: string;
      if (enrol) { await tx.enrolment.update({ where: { id: enrol.id }, data: { classId, status: "ACTIVE", leftAt: null } }); studentId = enrol.studentId; stats.updated++; }
      else {
        const gp = r.guardians.map((g) => g.phone);
        const existing = await findExistingStudent(tx, r.name, dob, gp);
        if (existing) { studentId = existing.id; stats.matchedStudents++; }
        else { studentId = (await tx.student.create({ data: { fullName: r.name, dateOfBirth: dob, gender: r.gender ?? undefined, currentSchoolId: imp.institutionId } })).id; stats.newStudents++; stats.createdStudentIds.push(studentId); }
        const sameYear = await tx.enrolment.findUnique({ where: { studentId_institutionId_academicYear: { studentId, institutionId: imp.institutionId, academicYear: imp.academicYear } } });
        if (sameYear) await tx.enrolment.update({ where: { id: sameYear.id }, data: { classId } }); // already enrolled under another number: keep that one
        else enrol = await tx.enrolment.create({ data: { studentId, institutionId: imp.institutionId, academicYear: imp.academicYear, classId, admissionNo: r.admissionNo, importId: imp.id } });
      }
      for (const g of r.guardians) {
        const have = await tx.guardianship.findUnique({ where: { studentId_phone: { studentId, phone: g.phone } } });
        if (!have) { await tx.guardianship.create({ data: { studentId, phone: g.phone, fullName: g.name, relationship: g.relationship, isPrimary: g === r.guardians[0], source: "ROSTER", importId: imp.id } }); stats.guardiansLinked++; }
        phones.add(g.phone);
      }
    }
  }, { timeout: 180_000, maxWait: 15_000 });
  // guardians who already have a verified account get their children straight away
  const users = await prisma.user.findMany({ where: { phone: { in: [...phones] }, role: "PARENT", phoneVerifiedAt: { not: null } }, select: { id: true } });
  for (const u of users) await linkGuardianships(u.id);
  await prisma.rosterImport.update({ where: { id: imp.id }, data: { status: "COMMITTED", committedAt: new Date(), summary: { ...(imp.summary as object), ...stats } } });
  return stats;
}

/** Undo a committed import, unless real school data (grades, attendance) was already recorded against it. */
export async function rollbackRoster(importId: string): Promise<"ok" | "in_use"> {
  const imp = await prisma.rosterImport.findUniqueOrThrow({ where: { id: importId } });
  const ids = (await prisma.enrolment.findMany({ where: { importId }, select: { id: true } })).map((e) => e.id);
  if ((await prisma.grade.count({ where: { enrolmentId: { in: ids } } })) + (await prisma.attendance.count({ where: { enrolmentId: { in: ids } } })) > 0) return "in_use";
  const created = ((imp.summary as any)?.createdStudentIds ?? []) as string[];
  await prisma.$transaction([
    prisma.guardianship.deleteMany({ where: { importId } }),
    prisma.enrolment.deleteMany({ where: { importId } }),
    prisma.rosterImport.update({ where: { id: importId }, data: { status: "ROLLED_BACK", rolledBackAt: new Date() } }),
  ]);
  for (const sid of created) { // students this import created and that nothing else refers to
    const used = (await prisma.enrolment.count({ where: { studentId: sid } })) + (await prisma.guardianship.count({ where: { studentId: sid } })) + (await prisma.application.count({ where: { studentId: sid } })) + (await prisma.credential.count({ where: { studentId: sid } }));
    if (!used) await prisma.student.delete({ where: { id: sid } }).catch(() => {});
  }
  return "ok";
}
