// Real SMTP delivery against an in-process SMTP server (no external mail service). Runs in its own process so SMTP_* is set before config loads.
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";

const skip = !process.env.INTEGRATION;

test("emails are delivered over plain SMTP (any provider, or one you run yourself)", { skip }, async () => {
  const received: { from: string; to: string; body: string }[] = [];
  const server = new SMTPServer({
    authOptional: true, disabledCommands: ["STARTTLS"],
    onData(stream, session, cb) { let b = ""; stream.on("data", (c) => (b += c)); stream.on("end", () => { received.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "", to: session.envelope.rcptTo[0]!.address, body: b }); cb(); }); },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = String((server.server.address() as AddressInfo).port); process.env.SMTP_FROM = "Enrolla <no-reply@school.test>";
  const { sendEmail } = await import("../../src/lib/mailer.js");
  await sendEmail("parent@example.mw", "Reset your Enrolla password", "Open this link: http://localhost:3000/reset?token=abc");
  assert.equal(received.length, 1);
  assert.equal(received[0]!.to, "parent@example.mw");
  assert.equal(received[0]!.from, "no-reply@school.test");
  assert.match(received[0]!.body, /Subject: Reset your Enrolla password/);
  assert.match(received[0]!.body, /reset\?token=abc/);
  await new Promise<void>((r) => server.close(() => r()));
});
