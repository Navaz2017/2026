import { prisma } from "../db.js";

export async function notifyUsers(userIds: string[], type: string, title: string, body: string, data?: object) {
  if (!userIds.length) return;
  await prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, type, title, body, data })) });
}

export async function institutionAdminIds(institutionId: string) {
  return (await prisma.user.findMany({ where: { institutionId, role: "INSTITUTION_ADMIN" }, select: { id: true } })).map((u) => u.id);
}

// Student's login plus their parent's, if any.
export async function applicantUserIds(studentId: string) {
  const s = await prisma.student.findUnique({ where: { id: studentId }, include: { parent: true } });
  return [s?.userId, s?.parent?.userId].filter((x): x is string => !!x);
}
