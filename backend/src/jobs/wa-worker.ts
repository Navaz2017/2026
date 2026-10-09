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
import { prisma } from "../db.js";
import os from "node:os";
import { chromePath, config } from "../config.js";
import { bigSurWithoutChrome, classifyWaError, waSessionDir } from "../lib/waSupport.js";
import { getObject } from "../lib/storage.js";

const require = createRequire(import.meta.url);
const wa = require("whatsapp-web.js") as typeof import("whatsapp-web.js");

const PLATFORM = "platform";
// The same database error every few seconds would flood the terminal: print each distinct problem at most once a minute, in one line.
const lastLogged = new Map<string, number>();
function logThrottled(what: string, e: unknown) {
  const msg = ((e as Error)?.message ?? String(e)).split("\n").filter(Boolean).pop() ?? "";
  const key = `${what}:${msg.slice(0, 80)}`;
  if (Date.now() - (lastLogged.get(key) ?? 0) < 60_000) return;
  lastLogged.set(key, Date.now());
  console.error(`[wa] ${what} problem: ${msg}`);
}
const env = { platform: process.platform, osRelease: os.release() };
const log = (key: string, ...a: unknown[]) => console.log(`[wa ${new Date().toISOString().slice(11, 19)} ${key === PLATFORM ? "platform" : key.slice(0, 8)}]`, ...a);
const clients = new Map<string, import("whatsapp-web.js").Client>();
const pairModes = new Map<string, string>(); // key -> phone used for code pairing ("" = QR); a change restarts the pairing
const starting = new Set<string>();
const stopping = new Set<string>(); // sessions WE are shutting down (admin pressed Cancel/Unlink): their errors are expected, not failures
const setState = (key: string, data: Record<string, unknown>) =>
  (key === PLATFORM
    ? prisma.platformWhatsApp.upsert({ where: { id: PLATFORM }, update: data, create: { id: PLATFORM, ...data } })
    : prisma.whatsAppSession.update({ where: { institutionId: key }, data })).catch(() => {});

async function start(id: string, pairPhone = "") {
  if (clients.has(id) || starting.has(id)) return;
  pairModes.set(id, pairPhone);
  if (clients.size + starting.size >= config.WA_MAX_SESSIONS) return void setState(id, { status: "FAILED", lastError: "Server is at WhatsApp capacity; contact support" });
  if (bigSurWithoutChrome(env, chromePath)) { // the Chrome that gets downloaded (146) cannot run on macOS 11; tell the admin right away
    log(id, "macOS 11 detected and no WHATSAPP_CHROME_PATH set");
    return void setState(id, { status: "FAILED", qr: null, pairingCode: null, lastError: "wa_err:mac11:no WHATSAPP_CHROME_PATH configured" });
  }
  starting.add(id);
  log(id, "starting", pairPhone ? "(phone-number code)" : "(QR)", "profile:", waSessionDir(config.WA_DATA_DIR, id), "chrome:", chromePath ?? "bundled");
  const c = new wa.Client({
    authStrategy: new wa.LocalAuth({ clientId: id, dataPath: config.WA_DATA_DIR }), // session survives restarts: no re-scan needed
    ...(pairPhone && { pairWithPhoneNumber: { phoneNumber: pairPhone.replace(/\D/g, ""), showNotification: true } }), // 8-character code instead of a QR scan
    puppeteer: { headless: true, executablePath: chromePath, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] },
  });
  c.on("loading_screen", (pct, msg) => log(id, `loading ${pct}% ${msg}`));
  c.on("qr", (qr) => { log(id, "QR ready"); setState(id, { status: "QR", qr, lastError: null }); });
  c.on("code", (code) => { log(id, "pairing code ready"); setState(id, { status: "CODE", pairingCode: code, qr: null, lastError: null }); });
  c.on("ready", () => { log(id, "CONNECTED as", c.info?.wid?.user); starting.delete(id); setState(id, { status: "CONNECTED", qr: null, pairingCode: null, pairPhone: null, phone: c.info?.wid?.user ? `+${c.info.wid.user}` : null, lastError: null }); });
  c.on("auth_failure", (m) => { log(id, "auth failure", m); setState(id, { status: "FAILED", lastError: `Authentication failed: ${m}` }); });
  c.on("disconnected", async (reason) => { log(id, "disconnected:", reason); await teardown(id, false); setState(id, { status: "DISCONNECTED", qr: null, pairingCode: null, phone: null, lastError: String(reason) }); });
  clients.set(id, c);
  try { await c.initialize(); }
  catch (e) {
    const msg = (e as Error).message;
    if (stopping.has(id) || clients.get(id) !== c) log(id, "start cancelled by the admin");   // Cancel pressed while Chrome was loading: not an error
    else {
      log(id, "FAILED to start:", msg);              // full reason in the terminal
      await teardown(id, false);
      setState(id, { status: "FAILED", qr: null, pairingCode: null, lastError: classifyWaError(msg, env) });
    }
  }
  starting.delete(id);
}

// Closing a browser that is still loading can hang forever: give it a few seconds, then kill the process.
async function destroyClient(c: import("whatsapp-web.js").Client) {
  await Promise.race([c.destroy().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  try { (c as any).pupBrowser?.process()?.kill("SIGKILL"); } catch { /* already gone */ }
}

async function teardown(id: string, logout: boolean) {
  const c = clients.get(id);
  clients.delete(id); pairModes.delete(id);
  if (!c) return;
  stopping.add(id);
  try {
    // Only a fully linked session can log out (that unlinks the device from the phone); one that is still loading is just closed.
    if (logout && c.info) await Promise.race([c.logout().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
    await destroyClient(c);
    if (logout) await fs.rm(waSessionDir(config.WA_DATA_DIR, id), { recursive: true, force: true }).catch(() => {}); // only THIS institution's folder
  } finally { starting.delete(id); stopping.delete(id); }
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
    // A FAILED session is NOT restarted by itself (that would relaunch Chrome every 5 s); the admin's "Try again" sets it back to STARTING.
    if (r.desired && r.status !== "FAILED" && !clients.has(r.key) && !starting.has(r.key)) { void start(r.key, r.pairPhone); await new Promise((res) => setTimeout(res, 3000)); } // stagger Chromium launches
    if (!r.desired && clients.has(r.key)) { await teardown(r.key, true); await setState(r.key, { status: "DISCONNECTED", qr: null, pairingCode: null, pairPhone: null, phone: null }); }
  }
}
let reconciling = false;
setInterval(() => { if (reconciling) return; reconciling = true; reconcile().catch((e) => logThrottled("reconcile", e)).finally(() => { reconciling = false; }); }, 5000);

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

let busy = false, lastSweep = 0, lastClean = 0;
async function pump() {
  if (busy) return;
  busy = true;
  try {
    // Housekeeping runs rarely (not on every tick): fewer queries means less load on the database and on this busy process.
    if (Date.now() - lastSweep > 60_000) {
      lastSweep = Date.now(); // a crash mid-send leaves SENDING rows behind: release them after 2 minutes
      await prisma.waOutbox.updateMany({ where: { status: "SENDING", updatedAt: { lt: new Date(Date.now() - 120_000) } }, data: { status: "PENDING" } });
    }
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
    if (Date.now() - lastClean > 3600_000) { // keep the table small (hourly)
      lastClean = Date.now();
      await prisma.waOutbox.deleteMany({ where: { status: { in: ["SENT", "FAILED", "CANCELLED"] }, updatedAt: { lt: new Date(Date.now() - 7 * 864e5) } } });
    }
  } finally { busy = false; }
}
setInterval(() => pump().catch((e) => logThrottled("outbox", e)), 2000);

process.on("SIGTERM", async () => { await Promise.all([...clients.keys()].map((id) => teardown(id, false))); process.exit(0); });

// A stray browser/network error must never kill the process that holds every institution's session.
process.on("unhandledRejection", (e) => console.error("[wa] unhandled rejection:", e));
process.on("uncaughtException", (e) => console.error("[wa] uncaught exception:", e));
