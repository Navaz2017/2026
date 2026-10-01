// Run as a separate process: `node dist/jobs/worker.js`. Scales independently of the API.
import { Worker } from "bullmq";
import { prisma } from "../db.js";
import { redis } from "./queue.js";
import { DEFAULT_TEMPLATES, renderLetter } from "../lib/letters.js";
import { applicantUserIds, notifyUsers } from "../lib/notify.js";

// Delivery adapters. Wire to AWS SES / SendGrid and the WhatsApp Cloud API (template messages) in deployment.
async function sendEmail(_to: string, _subject: string, _text: string) { /* TODO(provider) */ }
async function sendWhatsApp(_toE164: string, _text: string) { /* TODO(provider) */ }

new Worker<{ applicationId: string }>(
  "letters",
  async ({ data }) => {
    const app = await prisma.application.findUniqueOrThrow({
      where: { id: data.applicationId },
      include: { student: { include: { user: true, parent: { include: { user: true } } } }, program: { include: { institution: true } } },
    });
    if (app.status !== "ACCEPTED" && app.status !== "REJECTED") return;
    const kind = app.status === "ACCEPTED" ? "ACCEPTANCE" : "REJECTION";
    const tpl = await prisma.letterTemplate.findUnique({ where: { institutionId_kind: { institutionId: app.program.institutionId, kind } } });
    const text = renderLetter(tpl?.body ?? DEFAULT_TEMPLATES[kind], {
      "student.fullName": app.student.fullName,
      "program.title": app.program.title,
      "institution.name": app.program.institution.name,
      date: new Date().toISOString().slice(0, 10),
      signatory: tpl?.signatory ?? app.program.institution.name,
    });
    // TODO(pdf): render `text` on the institution letterhead to PDF, upload to S3, store key in Letter.storageKey.
    const recipients = [app.student.user, app.student.parent?.user].filter((u): u is NonNullable<typeof u> => !!u);
    const via: string[] = [];
    for (const u of recipients) {
      await sendEmail(u.email, `Your application: ${app.program.title}`, text); via.push("email");
      if (u.phone) { await sendWhatsApp(u.phone, text); via.push("whatsapp"); }
    }
    await prisma.letter.upsert({
      where: { applicationId: app.id },
      create: { applicationId: app.id, storageKey: "pending-pdf", deliveredVia: via },
      update: { deliveredVia: via },
    });
    await notifyUsers(await applicantUserIds(app.studentId), `APPLICATION_${app.status}`, `Application ${app.status.toLowerCase()}`, `Your application to ${app.program.title} was ${app.status.toLowerCase()}.`, { applicationId: app.id });
  },
  { connection: redis, concurrency: 10 },
);
