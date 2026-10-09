import { prisma } from "../db.js";
import { enqueueLetter } from "../jobs/queue.js";
import { applicantUserIds, notifyUsers } from "./notify.js";

// A decision (ACCEPTED/REJECTED) is made by the registrar at `decidedAt`, but the APPLICANT only learns about it - status, note,
// notification, letter - when it is PUBLISHED (`decisionPublishedAt`). Immediately, or later for all held letters together.
export const isHeld = (a: { decidedAt: Date | null; decisionPublishedAt: Date | null }) => !!a.decidedAt && !a.decisionPublishedAt;

// What an applicant (or their parent) is allowed to see of an application row.
export function maskHeld<T extends Record<string, any>>(a: T): T {
  const { decidedAt, decisionPublishedAt, ...rest } = a as any;
  if (decidedAt && !decisionPublishedAt) return { ...rest, status: "UNDER_REVIEW", decisionNote: null, offeredProgramId: null, letter: null } as T;
  return rest as T;
}

// Announce ONE decision. Safe to call twice and from several processes: only the caller that wins the update proceeds.
export async function publishDecision(applicationId: string): Promise<boolean> {
  const claimed = await prisma.application.updateMany({ where: { id: applicationId, decisionPublishedAt: null, status: { in: ["ACCEPTED", "REJECTED"] } }, data: { decisionPublishedAt: new Date() } });
  if (claimed.count !== 1) return false;
  const a = await prisma.application.findUniqueOrThrow({ where: { id: applicationId }, select: { id: true, status: true, studentId: true } });
  await notifyUsers(await applicantUserIds(a.studentId), `APPLICATION_${a.status}`, "", "", { applicationId: a.id });
  await enqueueLetter(a.id); // PDF + WhatsApp/email delivery; a sweeper retries if the queue is down
  return true;
}

// Release every held decision of one institution, together.
export async function releaseHeld(institutionId: string): Promise<number> {
  const held = await prisma.application.findMany({ where: { program: { institutionId }, decidedAt: { not: null }, decisionPublishedAt: null, status: { in: ["ACCEPTED", "REJECTED"] } }, select: { id: true } });
  let n = 0;
  for (const a of held) if (await publishDecision(a.id)) n++;
  return n;
}

// Called every minute: institutions whose scheduled release time has arrived.
export async function runLetterScheduler(now = new Date()) {
  const due = await prisma.institution.findMany({ where: { letterMode: "HOLD", lettersReleaseAt: { lte: now } }, select: { id: true } });
  let total = 0;
  for (const i of due) {
    // claim the schedule so two API processes do not both run it
    const c = await prisma.institution.updateMany({ where: { id: i.id, lettersReleaseAt: { lte: now } }, data: { lettersReleaseAt: null } });
    if (c.count === 1) total += await releaseHeld(i.id);
  }
  return total;
}
