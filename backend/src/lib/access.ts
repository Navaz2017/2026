import type { AuthUser } from "../middleware/auth.js";
import { prisma } from "../db.js";

// The single place that answers "may this user act for this student?"
export async function canActForStudent(user: AuthUser, studentId: string) {
  const s = await prisma.student.findUnique({ where: { id: studentId }, include: { parent: true } });
  if (!s) return null;
  if (user.role === "STUDENT" && s.userId === user.sub) return s;
  if (user.role === "PARENT" && s.parent?.userId === user.sub) return s;
  // a guardian the school linked to this child (School Hub roster) may also act for them
  if (user.role === "PARENT" && (await prisma.guardianship.count({ where: { studentId, guardianUserId: user.sub, status: "ACTIVE", relationship: { in: ["PARENT", "GUARDIAN"] } } })) > 0) return s;
  return null;
}
