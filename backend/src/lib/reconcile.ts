import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { applicantUserIds, institutionAdminIds, notifyUsers } from "./notify.js";

// Match a typed-in payment against an SMS received from a forwarder device.
// Safe to call from both sides (payment submitted / SMS arrived); whichever comes second performs the match.
// "One reference, one use" is enforced by DB unique indexes: Payment(provider,reference),
// SmsMessage(provider,reference) and Payment.smsId @unique.
export async function reconcile(provider: "AIRTEL_MONEY" | "MPAMBA", reference: string) {
  const ref = reference.toUpperCase();
  const result = await prisma.$transaction(
    async (tx) => {
      const payment = await tx.payment.findUnique({ where: { provider_reference: { provider, reference: ref } }, include: { application: { include: { program: true } } } });
      const sms = await tx.smsMessage.findUnique({ where: { provider_reference: { provider, reference: ref } } });
      if (!payment || !sms || payment.status === "CONFIRMED" || payment.smsId) return null;
      if (sms.payerPhone !== payment.payerPhone) return null; // phone must match the cash-out number
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
  const { payment, enough } = result;
  const app = payment.application;
  if (enough) {
    await notifyUsers(await applicantUserIds(app.studentId), "PAYMENT_CONFIRMED", "Payment confirmed", "Your application has been sent to the institution.", { applicationId: app.id });
    await notifyUsers(await institutionAdminIds(app.program.institutionId), "APPLICATION_RECEIVED", "New application", `New application for ${app.program.title}.`, { applicationId: app.id });
  } else {
    await notifyUsers(await applicantUserIds(app.studentId), "PAYMENT_UNDERPAID", "Payment amount too low", "The amount received is less than the amount due. Please contact support.", { applicationId: app.id });
  }
  return enough;
}
