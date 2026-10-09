// "Will WhatsApp work on THIS machine?"  Run:  npm run wa:check
// Starts the same Chrome the wa-worker would, and tries to reach WhatsApp Web. Prints what to fix.
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import { chromePath, config } from "../src/config.js";
import { bigSurWithoutChrome, classifyWaError } from "../src/lib/waSupport.js";

const env = { platform: process.platform, osRelease: os.release() };
const say = (ok: boolean | null, msg: string) => console.log(ok === null ? "  ·" : ok ? "  ✔" : "  ✘", msg);
console.log(`\nWhatsApp check on ${process.platform} ${os.release()} (${os.arch()})`);
say(null, `Chrome path: ${chromePath ?? "(not set - the Chrome downloaded by Puppeteer will be used)"}`);
say(null, `Sessions folder: ${config.WA_DATA_DIR}  (one sub-folder per institution)`);

if (bigSurWithoutChrome(env, chromePath)) {
  say(false, "macOS 11 (Big Sur) cannot run the Chrome that Puppeteer downloads (too new). Install Chrome 138, the last that runs on it:");
  console.log("\n      npx @puppeteer/browsers install chrome@138");
  console.log('      # it prints a path; put it in backend/.env as  WHATSAPP_CHROME_PATH="<that path>"');
  console.log("      # e.g. .../chrome/mac-138.x/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing\n");
  process.exit(1);
}
if (chromePath && !fs.existsSync(chromePath)) { say(false, `That Chrome path does not exist: ${chromePath}`); process.exit(1); }

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer") as typeof import("puppeteer");
let browser: import("puppeteer").Browser | undefined;
try {
  browser = await puppeteer.launch({ headless: true, executablePath: chromePath, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  say(true, `Browser starts: ${await browser.version()}`);
  const page = await browser.newPage();
  try { await page.goto("https://web.whatsapp.com/", { timeout: 25_000, waitUntil: "domcontentloaded" }); say(true, `Reached WhatsApp Web: "${await page.title()}"`); }
  catch (e) { say(false, `Cannot reach WhatsApp Web from this machine: ${(e as Error).message}. Check the internet connection / firewall / proxy.`); process.exitCode = 1; }
} catch (e) {
  const c = classifyWaError((e as Error).message, env);
  say(false, `Browser would not start: ${c}`);
  console.log("\n   Full error:", (e as Error).message.split("\n")[0]);
  if (process.platform === "linux") console.log("   Ubuntu: install Chrome with  sudo apt install ./google-chrome-stable_current_amd64.deb  (it brings the libraries), then set WHATSAPP_CHROME_PATH=/usr/bin/google-chrome-stable");
  process.exitCode = 1;
} finally { await browser?.close().catch(() => {}); }
if (!process.exitCode) console.log("\nAll good: start the service with  npm run dev:wa  (development) / the enrolla-wa service (server).\n");
