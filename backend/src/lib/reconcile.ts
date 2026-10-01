import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { normaliseReference } from "./reference.js";
import { applicantUserIds, institutionAdminIds, notifyUsers } from "./notify.js";

// Match a typed-in payment against an SMS received from a forwarder device.
// Safe to call from both sides (payment submitted / SMS arrived); whichever comes second performs the match.
// "One reference, one use" is enforced by DB unique indexes: Payment(provider,reference),
// SmsMessage(provider,reference) and Payment.smsId @unique.
// `refs` = every identifier we know for the transaction (Airtel bank deposits carry two; the applicant may have typed either).
export async function reconcile(provider: "AIRTEL_MONEY" | "MPAMBA", refs: string[]) {
  const ids = refs.filter(Boolean).map(normaliseReference);
  const result = await prisma.$transaction(
    async (tx) => {
      const payment = await tx.payment.findFirst({ where: { provider, reference: { in: ids } }, include: { application: { include: { program: true } } } });
      const sms = await tx.smsMessage.findFirst({ where: { provider, OR: [{ reference: { in: ids } }, { altReference: { in: ids } }] } });
      if (!payment || !sms || payment.status === "CONFIRMED" || payment.smsId) return null;
      // Mpamba SMS reveals the sender's number, so it must equal the number the applicant declared.
      // Airtel deposit SMS carry only a name; there the unique one-time transaction id + amount are the proof.
      if (sms.payerPhone && sms.payerPhone !== payment.payerPhone) return null;
      const enough = (sms.amountMinor ?? 0) >= payment.amountMinor;
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, smsId: null, status: "PENDING" },
        data: enough ? { status: "CONFIRMED", smsId: sms.id, confirmedAt: new Date() } : { status: "UNDERPAID", smsId: sms.id },
      });
      if (claimed.count !== 1) return null;
      if (enough) await tx.application.update({ where: { id: payment.applicationId }, data: { status: "SUBMITTED" } });
      return { payment, enough };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  ).catch((e) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(e.code)) return null; // lost the race; other side won
    throw e;
  });

  if (!result) return false;
  await announce(result.payment.application, result.enough);
  return result.enough;
}

type AppWithProgram = { id: string; studentId: string; program: { institutionId: string; title: string } };
// Tell the applicant (and parent) and the institution. Shared by SMS matching and manual owner confirmation.
export async function announce(app: AppWithProgram, enough: boolean) {
  if (enough) {
    await notifyUsers(await applicantUserIds(app.studentId), "PAYMENT_CONFIRMED", "Payment confirmed", "Your application has been sent to the institution.", { applicationId: app.id });
    await notifyUsers(await institutionAdminIds(app.program.institutionId), "APPLICATION_RECEIVED", "New application", `New application for ${app.program.title}.`, { applicationId: app.id });
  } else {
    await notifyUsers(await applicantUserIds(app.studentId), "PAYMENT_UNDERPAID", "Payment amount too low", "The amount received is less than the amount due. Please contact support.", { applicationId: app.id });
  }
  return enough;
}