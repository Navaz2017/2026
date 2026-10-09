import { prisma } from "../db.js";
import { config } from "../config.js";
import { sendSms, smsConfigured } from "./sms.js";

export type Channel = "whatsapp" | "sms" | "dev";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function platformWhatsAppConnected() {
  return (await prisma.platformWhatsApp.findUnique({ where: { id: "platform" } }))?.status === "CONNECTED";
}

// Try the platform WhatsApp number first (waits briefly for the wa-worker to confirm), then fall back to SMS.
// Returns the channel used, or null when nothing could deliver (callers decide what to do; dev echo is up to them).
export async function sendPlatformMessage(phone: string, text: string, waitMs = config.NODE_ENV === "test" ? 1500 : 10_000): Promise<Channel | null> {
  if (await platformWhatsAppConnected()) {
    const row = await prisma.waOutbox.create({ data: { sessionKey: "platform", toPhone: phone, text, maxAttempts: 1 } });
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const cur = await prisma.waOutbox.findUniqueOrThrow({ where: { id: row.id } });
      if (cur.status === "SENT") return "whatsapp";
      if (cur.status === "FAILED") break; // e.g. number not on WhatsApp
      await sleep(250);
    }
    // Give up on WhatsApp. If it is still queued, cancel so the user does not get the code twice.
    const cancelled = await prisma.waOutbox.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "CANCELLED" } });
    if (cancelled.count === 0) {
      const cur = await prisma.waOutbox.findUniqueOrThrow({ where: { id: row.id } });
      if (cur.status === "SENT" || cur.status === "SENDING") return "whatsapp"; // in flight: do not double-send
    }
  }
  if (smsConfigured()) {
    try { await sendSms(phone, text); return "sms"; } catch (e) { console.warn("SMS failed:", (e as Error).message); }
  }
  return null;
}

export const devEcho = () => config.NODE_ENV !== "production";

// The wa-worker writes a timestamp every 5 s. Older than 20 s = the WhatsApp service is not running.
export async function waWorkerOnline() {
  const r = await prisma.setting.findUnique({ where: { key: "wa.heartbeat" } });
  return !!r && Date.now() - new Date(r.value).getTime() < 20_000;
}

// Send through one specific WhatsApp session (an institution's own number, or "platform") and wait for the outcome.
export async function sendViaSession(sessionKey: string, phone: string, text: string, waitMs = 15_000): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.waOutbox.create({ data: { sessionKey, toPhone: phone, text, maxAttempts: 1 } });
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const cur = await prisma.waOutbox.findUniqueOrThrow({ where: { id: row.id } });
    if (cur.status === "SENT") return { ok: true };
    if (cur.status === "FAILED") return { ok: false, error: cur.lastError ?? "failed" };
    await sleep(250);
  }
  await prisma.waOutbox.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "CANCELLED" } });
  return { ok: false, error: "timeout" };
}
