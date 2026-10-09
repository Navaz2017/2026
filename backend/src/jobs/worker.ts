// Run as a separate process: `node dist/src/jobs/worker.js`. Scales independently of the API.
import { Worker } from "bullmq";
import { prisma } from "../db.js";
import { enqueueLetter, workerRedis } from "./queue.js";
import { DEFAULT_TEMPLATES_BY_LANG, isLang, renderLetter } from "../lib/letters.js";
import { letterPdf } from "../lib/letterPdf.js";
import { putObject } from "../lib/storage.js";
import { sendEmail } from "../lib/mailer.js";

new Worker<{ applicationId: string }>(
  "letters",
  async ({ data }) => {
    const app = await prisma.application.findUniqueOrThrow({
      where: { id: data.applicationId },
      include: { student: { include: { user: true, parent: { include: { user: true } } } }, program: { include: { institution: { include: { whatsapp: true } } } } },
    });
    if (app.status !== "ACCEPTED" && app.status !== "REJECTED") return;
    if (!app.decisionPublishedAt) return; // held: the registrar has not released this letter yet
    const inst = app.program.institution;
    const offered = app.offeredProgramId ? await prisma.program.findUnique({ where: { id: app.offeredProgramId }, select: { title: true } }) : null;
    const kind = app.status === "ACCEPTED" ? "ACCEPTANCE" : "REJECTION";
    const tpl = await prisma.letterTemplate.findUnique({ where: { institutionId_kind: { institutionId: inst.id, kind } } });
    const recipients = [app.student.user, app.student.parent?.user].filter((u): u is NonNullable<typeof u> => !!u);
    const lang = recipients.map((u) => u.language).find(isLang) ?? "en"; // institution-custom template wins over language defaults
    const text = renderLetter(tpl?.body ?? DEFAULT_TEMPLATES_BY_LANG[lang][kind], {
      "student.fullName": app.student.fullName, "program.title": offered?.title ?? app.program.title, "institution.name": inst.name,
      date: new Date().toISOString().slice(0, 10), signatory: tpl?.signatory ?? inst.name,
    });
    const key = `letters/${app.id}.pdf`;
    await putObject(key, await letterPdf(inst.name, text), "application/pdf");
    const via: string[] = [];
    const letter = await prisma.letter.upsert({ where: { applicationId: app.id }, create: { applicationId: app.id, storageKey: key, deliveredVia: [] }, update: { storageKey: key } });

    for (const u of recipients) {
      if (u.email) await sendEmail(u.email, `${inst.name}: ${app.program.title}`, text).then(() => via.includes("email") || via.push("email")).catch((e) => console.error("email failed", e.message));
      // WhatsApp only when the institution has linked its own number; the wa-worker records success on the Letter.
      if (u.phone && inst.whatsapp?.status === "CONNECTED") {
        // The wa-worker picks this up from the database (retries with back-off, records delivery on the Letter).
        const queued = await prisma.waOutbox.findFirst({ where: { sessionKey: inst.id, letterId: letter.id, toPhone: u.phone }, select: { id: true } });
        if (!queued) await prisma.waOutbox.create({ data: { sessionKey: inst.id, toPhone: u.phone, text, letterId: letter.id, attachmentKey: key, attachmentName: "Decision-letter.pdf" } });
      }
    }
    await prisma.letter.update({ where: { id: letter.id }, data: { deliveredVia: { set: [...new Set([...letter.deliveredVia, ...via])] } } });
  },
  { connection: workerRedis(), concurrency: 10 },
);

// Safety net: decisions whose letter job was lost (Redis down, crash) are re-queued every minute.
setInterval(async () => {
  const stuck = await prisma.application.findMany({ where: { status: { in: ["ACCEPTED", "REJECTED"] }, decidedAt: { lt: new Date(Date.now() - 90_000) }, decisionPublishedAt: { not: null }, letter: null }, select: { id: true }, take: 50 });
  for (const a of stuck) await enqueueLetter(a.id);
}, 60_000);
