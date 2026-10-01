import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { config } from "../config.js";

const ses = new SESClient({ region: config.S3_REGION });
export const outbox: { to: string; subject: string; text: string }[] = []; // inspected by tests in non-production

export async function sendEmail(to: string, subject: string, text: string) {
  if (config.NODE_ENV !== "production") {
    outbox.push({ to, subject, text });
    if (config.NODE_ENV === "development") console.log(`[email -> ${to}] ${subject}\n${text}`);
    return;
  }
  await ses.send(new SendEmailCommand({
    Source: process.env.SES_FROM!, Destination: { ToAddresses: [to] },
    Message: { Subject: { Data: subject }, Body: { Text: { Data: text } } },
  }));
}
