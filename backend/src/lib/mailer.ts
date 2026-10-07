import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";

// Plain SMTP: works with any provider (including one you run yourself) — no cloud account needed.
// Without SMTP_HOST, mail is only logged (development) / logged with a warning (production).
export const outbox: { to: string; subject: string; text: string }[] = []; // inspected by tests

let transport: Transporter | undefined;
const smtp = () => (transport ??= nodemailer.createTransport({
  host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE === "true",
  auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
}));

export async function sendEmail(to: string, subject: string, text: string) {
  if (config.NODE_ENV !== "production") outbox.push({ to, subject, text });
  if (!config.SMTP_HOST) {
    if (config.NODE_ENV !== "test") console.log(`[email not sent - SMTP not configured] to=${to} subject="${subject}"\n${text}`);
    return;
  }
  await smtp().sendMail({ from: config.SMTP_FROM, to, subject, text });
}
