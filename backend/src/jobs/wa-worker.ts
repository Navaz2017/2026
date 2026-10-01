// Run as ONE separate process: `node dist/src/jobs/wa-worker.js`.
// Owns every live whatsapp-web.js client (one headless Chromium per linked institution).
//
// !! whatsapp-web.js is an UNOFFICIAL client. Using it can breach WhatsApp's Terms of Service and the linked
// number can be banned. Mitigations here: only low-volume transactional messages to people who applied,
// randomised delay between sends, rate limit. Email + in-app notification always remain as fallback.
// The sender is isolated behind WaJob so it can be swapped for the official WhatsApp Business Cloud API.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { Worker, UnrecoverableError } from "bullmq";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { getObject } from "../lib/storage.js";
import { workerRedis, type WaJob } from "./queue.js";

const require = createRequire(import.meta.url);
const wa = require("whatsapp-web.js") as typeof import("whatsapp-web.js");

const clients = new Map<string, import("whatsapp-web.js").Client>();
const starting = new Set<string>();
const setState = (institutionId: string, data: Record<string, unknown>) =>
  prisma.whatsAppSession.update({ where: { institutionId }, data }).catch(() => {});

async function start(id: string) {
  if (clients.has(id) || starting.has(id)) return;
  if (clients.size + starting.size >= config.WA_MAX_SESSIONS) return void setState(id, { status: "FAILED", lastError: "Server is at WhatsApp capacity; contact support" });
  starting.add(id);
  const c = new wa.Client({
    authStrategy: new wa.LocalAuth({ clientId: id, dataPath: config.WA_DATA_DIR }), // session survives restarts: no re-scan needed
    puppeteer: { headless: true, executablePath: config.PUPPETEER_EXECUTABLE_PATH, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] },
  });
  c.on("qr", (qr) => setState(id, { status: "QR", qr, lastError: null }));
  c.on("ready", () => { starting.delete(id); setState(id, { status: "CONNECTED", qr: null, phone: c.info?.wid?.user ? `+${c.info.wid.user}` : null, lastError: null }); });
  c.on("auth_failure", (m) => setState(id, { status: "FAILED", lastError: `Authentication failed: ${m}` }));
  c.on("disconnected", async (reason) => { await teardown(id, false); setState(id, { status: "DISCONNECTED", qr: null, phone: null, lastError: String(reason) }); });
  clients.set(id, c);
  try { await c.initialize(); } catch (e) { await teardown(id, false); setState(id, { status: "FAILED", qr: null, lastError: (e as Error).message.slice(0, 200) }); }
  starting.delete(id);
}

async function teardown(id: string, logout: boolean) {
  const c = clients.get(id);
  clients.delete(id);
  if (!c) return;
  if (logout) await c.logout().catch(() => {}); // unlinks the device from the institution's phone
  await c.destroy().catch(() => {});
  if (logout) await fs.rm(path.join(config.WA_DATA_DIR, `session-${id}`), { recursive: true, force: true }).catch(() => {});
}

// Reconcile DB intent with reality every 5 s (also restores sessions after a restart).
async function reconcile() {
  const rows = await prisma.whatsAppSession.findMany();
  for (const r of rows) {
    if (r.desired && !clients.has(r.institutionId)) { void start(r.institutionId); await new Promise((res) => setTimeout(res, 3000)); } // stagger Chromium launches
    if (!r.desired && clients.has(r.institutionId)) { await teardown(r.institutionId, true); await setState(r.institutionId, { status: "DISCONNECTED", qr: null, phone: null }); }
  }
}
setInterval(() => reconcile().catch((e) => console.error("reconcile", e)), 5000);

new Worker<WaJob>("wa-send", async ({ data }) => {
  const c = clients.get(data.institutionId);
  const s = await prisma.whatsAppSession.findUnique({ where: { institutionId: data.institutionId } });
  if (!c || s?.status !== "CONNECTED") throw new Error("whatsapp not connected"); // retried with back-off
  const digits = data.to.replace(/\D/g, "");
  const id = await c.getNumberId(digits);
  if (!id) throw new UnrecoverableError("number is not on WhatsApp"); // no point retrying; email fallback already sent
  await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500)); // human-like pacing
  await c.sendMessage(id._serialized, data.text);
  if (data.attachment) {
    const buf = await getObject(data.attachment.key);
    await c.sendMessage(id._serialized, new wa.MessageMedia("application/pdf", buf.toString("base64"), data.attachment.filename));
  }
  if (data.letterId) {
    const l = await prisma.letter.findUnique({ where: { id: data.letterId } });
    if (l && !l.deliveredVia.includes("whatsapp")) await prisma.letter.update({ where: { id: l.id }, data: { deliveredVia: { push: "whatsapp" } } });
  }
}, { connection: workerRedis(), concurrency: 2, limiter: { max: 20, duration: 60_000 } });

process.on("SIGTERM", async () => { await Promise.all([...clients.keys()].map((id) => teardown(id, false))); process.exit(0); });
