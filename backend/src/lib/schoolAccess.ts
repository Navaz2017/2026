import type { AuthUser } from "../middleware/auth.js";
import { prisma } from "../db.js";

// Who may do what in School Hub. Everything is derived from the link tables (docs/school-hub.md):
// staff <- TeachingAssignment / institutionId, guardians <- Guardianship, students <- Student.userId.

export const instOf = (user: AuthUser) => user.inst as string;

/** Admin: any class of their school. Teacher: only classes they are assigned to (class teacher or subject teacher). */
export async function canAccessClass(user: AuthUser, classId: string) {
  const c = await prisma.schoolClass.findFirst({ where: { id: classId, institutionId: user.inst ?? "-" } });
  if (!c) return null;
  if (user.role === "INSTITUTION_ADMIN") return c;
  if (user.role !== "TEACHER") return null;
  const ok = c.classTeacherId === user.sub || (await prisma.teachingAssignment.count({ where: { teacherId: user.sub, classId } })) > 0;
  return ok ? c : null;
}

/** May this user enter results for this subject in this class? Admin, the class teacher, or that subject's teacher. */
export async function canGrade(user: AuthUser, classId: string, subjectId: string) {
  const c = await canAccessClass(user, classId);
  if (!c) return null;
  if (user.role === "INSTITUTION_ADMIN" || c.classTeacherId === user.sub) return c;
  return (await prisma.teachingAssignment.count({ where: { teacherId: user.sub, classId, subjectId } })) > 0 ? c : null;
}

/** Classes a staff member can see. */
export async function accessibleClassIds(user: AuthUser, year?: string) {
  if (user.role === "INSTITUTION_ADMIN") return (await prisma.schoolClass.findMany({ where: { institutionId: user.inst ?? "-", ...(year && { academicYear: year }) }, select: { id: true } })).map((c) => c.id);
  const led = await prisma.schoolClass.findMany({ where: { classTeacherId: user.sub, institutionId: user.inst ?? "-", ...(year && { academicYear: year }) }, select: { id: true } });
  const taught = await prisma.teachingAssignment.findMany({ where: { teacherId: user.sub, class: { institutionId: user.inst ?? "-", ...(year && { academicYear: year }) } }, select: { classId: true } });
  return [...new Set([...led.map((c) => c.id), ...taught.map((t) => t.classId)])];
}

export interface ChildAccess { studentId: string; canViewProgress: boolean; blocked: Set<string> }
/** May this parent/student see this child's school data? (A student sees only themselves.) */
export async function childAccess(user: AuthUser, studentId: string): Promise<ChildAccess | null> {
  if (user.role === "STUDENT") {
    const s = await prisma.student.findFirst({ where: { id: studentId, userId: user.sub }, select: { id: true } });
    return s ? { studentId, canViewProgress: true, blocked: new Set() } : null;
  }
  if (user.role === "PARENT") {
    const g = await prisma.guardianship.findFirst({ where: { studentId, guardianUserId: user.sub, status: "ACTIVE" } });
    return g ? { studentId, canViewProgress: g.canViewProgress, blocked: new Set(g.blockedInstitutionIds) } : null;
  }
  return null;
}

/** A roster lists guardians by phone. When that phone's owner (verified by OTP) is a PARENT account, the link is completed. Idempotent. */
export async function linkGuardianships(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true, phoneVerifiedAt: true, role: true } });
  if (!u?.phone || !u.phoneVerifiedAt || u.role !== "PARENT") return 0;
  const r = await prisma.guardianship.updateMany({ where: { phone: u.phone, guardianUserId: null, status: "ACTIVE" }, data: { guardianUserId: userId } });
  return r.count;
}

/** Everyone who should hear about something concerning these students: linked, willing, not blocked guardians + the student's own account. */
export async function audienceFor(studentIds: string[], institutionId: string, opts: { notices?: boolean } = {}) {
  if (!studentIds.length) return { userIds: [] as string[], phones: [] as string[] };
  const gs = await prisma.guardianship.findMany({ where: { studentId: { in: studentIds }, status: "ACTIVE", ...(opts.notices && { receivesNotices: true }), NOT: { blockedInstitutionIds: { has: institutionId } } }, select: { guardianUserId: true, phone: true } });
  const studs = await prisma.student.findMany({ where: { id: { in: studentIds }, userId: { not: null } }, select: { userId: true } });
  return {
    userIds: [...new Set([...gs.map((g) => g.guardianUserId), ...studs.map((s) => s.userId)].filter((x): x is string => !!x))],
    phones: [...new Set(gs.map((g) => g.phone))],
  };
}
