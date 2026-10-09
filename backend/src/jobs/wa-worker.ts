// Run as ONE separate process: `node dist/src/jobs/wa-worker.js`.
// Owns every live whatsapp-web.js client: the platform's own number ("platform", sends verification codes) and
// one per linked institution (sends decision letters). Each is a headless Chromium.
//
// !! whatsapp-web.js is an UNOFFICIAL client. Using it can breach WhatsApp's Terms of Service and the linked
// number can be banned. Mitigations here: only low-volume transactional messages to people who signed up or
// applied, randomised delay on institution sends, rate limit. SMS (Africa's Talking), email and in-app
// notifications always remain as fallback. The sender is isolated behind WaOutbox so it can be swapped for the
// official WhatsApp Business Cloud API.
// Work arrives through the database (WaOutbox rows) - no Redis needed.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { getObject } from "../lib/storage.js";

const require = createRequire(import.meta.url);
const wa = require("whatsapp-web.js") as typeof import("whatsapp-web.js");

const PLATFORM = "platform";
// Machine-readable reasons the dashboards translate (anything else is shown as it is).
const friendly = (m: string) =>
  /ERR_(TUNNEL|INTERNET|NAME_NOT_RESOLVED|CONNECTION|PROXY|TIMED_OUT)/i.test(m) ? "wa_err:network"
  : /Could not find|Failed to launch|executable|ENOENT|No usable sandbox/i.test(m) ? "wa_err:no_chrome"
  : m.slice(0, 200);
const clients = new Map<string, import("whatsapp-web.js").Client>();
const pairModes = new Map<string, string>(); // key -> phone used for code pairing ("" = QR); a change restarts the pairing
const starting = new Set<string>();
const setState = (key: string, data: Record<string, unknown>) =>
  (key === PLATFORM
    ? prisma.platformWhatsApp.upsert({ where: { id: PLATFORM }, update: data, create: { id: PLATFORM, ...data } })
    : prisma.whatsAppSession.update({ where: { institutionId: key }, data })).catch(() => {});

async function start(id: string, pairPhone = "") {
  if (clients.has(id) || starting.has(id)) return;
  pairModes.set(id, pairPhone);
  if (clients.size + starting.size >= config.WA_MAX_SESSIONS) return void setState(id, { status: "FAILED", lastError: "Server is at WhatsApp capacity; contact support" });
  starting.add(id);
  const c = new wa.Client({
    authStrategy: new wa.LocalAuth({ clientId: id, dataPath: config.WA_DATA_DIR }), // session survives restarts: no re-scan needed
    ...(pairPhone && { pairWithPhoneNumber: { phoneNumber: pairPhone.replace(/\D/g, ""), showNotification: true } }), // 8-character code instead of a QR scan
    puppeteer: { headless: true, executablePath: config.PUPPETEER_EXECUTABLE_PATH, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] },
  });
  c.on("qr", (qr) => setState(id, { status: "QR", qr, lastError: null }));
  c.on("code", (code) => setState(id, { status: "CODE", pairingCode: code, qr: null, lastError: null }));
  c.on("ready", () => { starting.delete(id); setState(id, { status: "CONNECTED", qr: null, pairingCode: null, pairPhone: null, phone: c.info?.wid?.user ? `+${c.info.wid.user}` : null, lastError: null }); });
  c.on("auth_failure", (m) => setState(id, { status: "FAILED", lastError: `Authentication failed: ${m}` }));
  c.on("disconnected", async (reason) => { await teardown(id, false); setState(id, { status: "DISCONNECTED", qr: null, pairingCode: null, phone: null, lastError: String(reason) }); });
  clients.set(id, c);
  try { await c.initialize(); } catch (e) { await teardown(id, false); setState(id, { status: "FAILED", qr: null, pairingCode: null, lastError: friendly((e as Error).message) }); }
  starting.delete(id);
}

async function teardown(id: string, logout: boolean) {
  const c = clients.get(id);
  clients.delete(id); pairModes.delete(id);
  if (!c) return;
  if (logout) await c.logout().catch(() => {}); // unlinks the device from the phone
  await c.destroy().catch(() => {});
  if (logout) await fs.rm(path.join(config.WA_DATA_DIR, `session-${id}`), { recursive: true, force: true }).catch(() => {});
}

// Reconcile DB intent with reality every 5 s (also restores sessions after a restart).
async function reconcile() {
  const rows = [
    ...(await prisma.platformWhatsApp.findMany()).map((r) => ({ key: PLATFORM, desired: r.desired, pairPhone: r.pairPhone ?? "", status: r.status })),
    ...(await prisma.whatsAppSession.findMany()).map((r) => ({ key: r.institutionId, desired: r.desired, pairPhone: r.pairPhone ?? "", status: r.status })),
  ];
  for (const r of rows) {
    // The admin switched between QR and phone-number pairing before finishing: start the pairing again the new way.
    if (r.desired && clients.has(r.key) && r.status !== "CONNECTED" && pairModes.get(r.key) !== r.pairPhone) await teardown(r.key, false);
    if (r.desired && !clients.has(r.key) && !starting.has(r.key)) { void start(r.key, r.pairPhone); await new Promise((res) => setTimeout(res, 3000)); } // stagger Chromium launches
    if (!r.desired && clients.has(r.key)) { await teardown(r.key, true); await setState(r.key, { status: "DISCONNECTED", qr: null, pairingCode: null, pairPhone: null, phone: null }); }
  }
}
setInterval(() => reconcile().catch((e) => console.error("reconcile", e)), 5000);

// The dashboards use this to say "the WhatsApp service is not running" instead of waiting forever on "Starting".
const beat = () => prisma.setting.upsert({ where: { key: "wa.heartbeat" }, update: { value: new Date().toISOString() }, create: { key: "wa.heartbeat", value: new Date().toISOString() } }).catch(() => {});
setInterval(beat, 5000); void beat();

// ---- outbox
const NOT_ON_WA = "not_on_whatsapp";
async function deliver(m: { id: string; sessionKey: string; toPhone: string; text: string; attachmentKey: string | null; attachmentName: string | null; letterId: string | null }) {
  const c = clients.get(m.sessionKey);
  if (!c) throw new Error("whatsapp not connected");
  const id = await c.getNumberId(m.toPhone.replace(/\D/g, ""));
  if (!id) throw new Error(NOT_ON_WA);
  if (m.sessionKey !== PLATFORM) await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500)); // human-like pacing for letters
  await c.sendMessage(id._serialized, m.text);
  if (m.attachmentKey) {
    const buf = await getObject(m.attachmentKey);
    await c.sendMessage(id._serialized, new wa.MessageMedia("application/pdf", buf.toString("base64"), m.attachmentName ?? "document.pdf"));
  }
  if (m.letterId) {
    const l = await prisma.letter.findUnique({ where: { id: m.letterId } });
    if (l && !l.deliveredVia.includes("whatsapp")) await prisma.letter.update({ where: { id: l.id }, data: { deliveredVia: { push: "whatsapp" } } });
  }
}

let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  try {
    // A crash mid-send leaves SENDING rows behind: release them after 2 minutes.
    await prisma.waOutbox.updateMany({ where: { status: "SENDING", updatedAt: { lt: new Date(Date.now() - 120_000) } }, data: { status: "PENDING" } });
    const due = await prisma.waOutbox.findMany({ where: { status: "PENDING", nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: 10 });
    for (const m of due) {
      const claimed = await prisma.waOutbox.updateMany({ where: { id: m.id, status: "PENDING" }, data: { status: "SENDING" } });
      if (claimed.count !== 1) continue;
      try {
        await deliver(m);
        await prisma.waOutbox.update({ where: { id: m.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, lastError: null } });
      } catch (e) {
        const msg = (e as Error).message.slice(0, 200);
        const attempts = m.attempts + 1;
        const final = msg === NOT_ON_WA || attempts >= m.maxAttempts;
        await prisma.waOutbox.update({ where: { id: m.id }, data: { attempts, lastError: msg, status: final ? "FAILED" : "PENDING", nextAttemptAt: new Date(Date.now() + 30_000 * 2 ** (attempts - 1)) } });
      }
    }
    // Housekeeping: keep the table small.
    await prisma.waOutbox.deleteMany({ where: { status: { in: ["SENT", "FAILED", "CANCELLED"] }, updatedAt: { lt: new Date(Date.now() - 7 * 864e5) } } });
  } finally { busy = false; }
}
setInterval(() => pump().catch((e) => console.error("outbox", e)), 1000);

process.on("SIGTERM", async () => { await Promise.all([...clients.keys()].map((id) => teardown(id, false))); process.exit(0); });
