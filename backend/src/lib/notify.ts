import { prisma } from "../db.js";
import { publish } from "../realtime.js";

export async function notifyUsers(userIds: string[], type: string, title: string, body: string, data?: object) {
  if (!userIds.length) return;
  const rows = await prisma.notification.createManyAndReturn({ data: userIds.map((userId) => ({ userId, type, title, body, data })) });
  // Live delivery to anyone who has the app open (no-op if nobody is connected).
  for (const n of rows) await publish([n.userId], { type: "notification", notification: { id: n.id, type: n.type, data: n.data, createdAt: n.createdAt, readAt: null } });
}

export async function institutionAdminIds(institutionId: string) {
  return (await prisma.user.findMany({ where: { institutionId, role: "INSTITUTION_ADMIN" }, select: { id: true } })).map((u) => u.id);
}

// Student's login plus their parent's, if any.
export async function applicantUserIds(studentId: string) {
  const s = await prisma.student.findUnique({ where: { id: studentId }, include: { parent: true } });
  return [s?.userId, s?.parent?.userId].filter((x): x is string => !!x);
}
