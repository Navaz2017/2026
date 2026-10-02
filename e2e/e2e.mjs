import fs from "node:fs";
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
const require = createRequire(new URL("../backend/package.json", import.meta.url));
const OTPAuth = require("otpauth");
const code = () => new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32("JBSWY3DPEHPK3PXP") }).generate();
const SHOTS = process.env.SHOTS ?? "./shots", BASE = "http://localhost:3000";

fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox"] });
const results = []; const errors = [];
const check = (name, ok, extra = "") => { results.push([ok, name, extra]); console.log(ok ? "PASS" : "FAIL", name, extra); };
async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.on("response", (r) => { if (r.status() >= 400 && r.status() !== 401) errors.push("HTTP " + r.status() + " " + r.request().method() + " " + r.url()); });
  page.on("response", (r) => { if (r.status() >= 400 && r.status() !== 401) errors.push("HTTP " + r.status() + " " + r.request().method() + " " + r.url()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/401|favicon|net::ERR/.test(m.text())) errors.push("console: " + m.text()); });
  return { ctx, page };
}
async function login(page, email, withCode = false) {
  await page.goto(BASE + "/login");
  await page.fill('input[name=email]', email); await page.fill('input[name=password]', "Passw0rd-demo1");
  await page.click('form button.btn.primary');
  if (withCode) { await page.waitForSelector('input[name=code]'); await page.fill('input[name=code]', code()); await page.click('form button.btn.primary'); }
  await page.waitForURL(/\/app\//, { timeout: 15000 });
}
try {
  // 0. public landing page: English by default, programmes listed with the student-facing total
  let { ctx, page } = await fresh();
  await page.goto(BASE + "/");
  check("landing page is in English by default", (await page.locator("h1").textContent()) === "Find your place. Apply with confidence.");
  await page.waitForSelector("text=BSc Computer Science");
  check("landing lists programmes with total incl. service fee (MK 13,000)", (await page.locator("#open").innerText()).includes("MK 13,000"));
  const order = await page.locator("header .lang").allTextContents();
  check("English is the first language option", order[0] === "English" && order.join() === "English,Chichewa,Chitumbuka", order.join());
  const fonts = await page.evaluate(() => ({ h: getComputedStyle(document.querySelector("h1")).fontFamily, b: getComputedStyle(document.body).fontFamily }));
  check("serif headings + sans body fonts", /Source Serif/.test(fonts.h) && /Source Sans/.test(fonts.b), JSON.stringify(fonts));
  check("fonts actually loaded from our own bundle", await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some((f) => f.family.includes("Source Serif") && f.status === "loaded"); }));
  await page.screenshot({ path: `${SHOTS}/landing-en.png`, fullPage: true });
  await page.locator("header").getByRole("button", { name: "Chichewa" }).click();
  check("landing page switches to Chichewa", (await page.locator("h1").textContent()) === "Pezani malo anu. Pemphani molimba mtima.");
  await page.screenshot({ path: `${SHOTS}/landing-ny.png` });
  await ctx.close();

  // 1. language switching on the public login page
  ({ ctx, page } = await fresh());
  await page.goto(BASE + "/login");
  await page.getByRole("button", { name: "Chichewa" }).click();
  await page.screenshot({ path: `${SHOTS}/login-en-ny.png` });
  check("login page in Chichewa", (await page.locator("h1").textContent()) === "Lowani");
  await page.getByRole("button", { name: "Chitumbuka" }).click();
  check("login page in Tumbuka", (await page.locator("h1").textContent()) === "Ŵinjani");
  await page.reload(); await page.waitForSelector("h1");
  check("language choice survives reload", (await page.locator("h1").textContent()) === "Ŵinjani");
  await page.getByRole("button", { name: "Chichewa" }).click();

  // 2. parent signs up in Chichewa -> whole app in Chichewa
  await page.goto(BASE + "/signup");
  await page.fill('input[name=fullName]', "Mayi Phiri"); await page.fill('input[name=email]', "mayi@example.mw");
  await page.fill('input[name=occupation]', "Mlimi"); await page.fill('input[name=password]', "very-long-password-1");
  await page.check('input[name=consent]');
  await page.click('form button.btn.primary');
  await page.waitForURL(/\/app\/family/, { timeout: 15000 });
  const nav = (await page.locator("nav.side").innerText());
  check("parent nav is Chichewa", nav.includes("Ana anga") && nav.includes("Sakani sukulu") && nav.includes("Zopempha zanga"), nav.replace(/\n/g, " | "));
  check("sign out button in Chichewa", await page.getByRole("button", { name: "Tulukani" }).isVisible());
  await page.fill('input[type=date]', "2015-05-05"); await page.locator('form input').first().fill("Mphatso Phiri");
  await page.locator('form button.btn.primary').click();
  await page.waitForSelector("text=Mphatso Phiri");
  check("parent registered a child", true);
  await page.goto(BASE + "/app/browse"); await page.waitForSelector("text=BSc Computer Science");
  check("parent sees programme catalogue", true);
  await page.screenshot({ path: `${SHOTS}/parent-browse-ny.png` });
  await page.reload(); await page.waitForSelector("nav.side");
  check("session restored from httpOnly cookie after reload", (await page.locator("nav.side").innerText()).includes("Ana anga"));
  const cookies = await ctx.cookies();
  const rt = cookies.find((c) => c.name === "rt");
  check("refresh token cookie is httpOnly + SameSite=Strict", !!rt && rt.httpOnly && rt.sameSite === "Strict");
  check("refresh token not readable by page scripts", !(await page.evaluate(() => document.cookie)).includes("rt="));
  await ctx.close();

  // 3. owner: MFA login, dashboard + all six screens
  ({ ctx, page } = await fresh());
  await page.goto(BASE + "/login"); await page.getByRole("button", { name: "Chichewa" }).click();
  await page.fill('input[name=email]', "owner@enrolla.test"); await page.fill('input[name=password]', "Passw0rd-demo1");
  await page.click('form button.btn.primary');
  await page.waitForSelector('input[name=code]');
  check("password-only login asks for security code (Chichewa)", (await page.locator("form").innerText()).includes("Lembani khodi"));
  await page.fill('input[name=code]', code()); await page.click('form button.btn.primary');
  await page.waitForURL(/\/app\/owner/, { timeout: 15000 });
  await page.waitForSelector("figure.chart svg");
  check("owner dashboard shows 3 charts", (await page.locator("figure.chart svg").count()) === 3);
  const bt = await page.locator("main, .main").innerText(); check("dashboard warns that no SMS phone is registered", bt.includes("Palibe foni ya SMS"), bt.slice(0, 400).replace(/\n/g, " | "));
  await page.screenshot({ path: `${SHOTS}/owner-dashboard-ny.png`, fullPage: true });
  for (const [href, text] of [["/app/owner/institutions", "Kutsimikizira"], ["/app/owner/payments", "Malipiro"], ["/app/owner/devices", "Mafoni a SMS"], ["/app/owner/settlements", "Kulipira"], ["/app/owner/revenue", "Kugawana"], ["/app/owner/users", "Ogwiritsa"], ["/app/owner/audit", "Mbiri"]]) {
    await page.click(`nav.side a[href="${href}"]`); await page.waitForSelector(`h1:has-text("${text}")`, { timeout: 8000 }).catch(async () => { console.log("H1 now:", await page.locator("h1").allTextContents(), page.url()); throw new Error("screen " + href); });
    check(`owner screen ${href}`, true);
  }
  await page.click('nav.side a[href="/app/owner/devices"]');
  await page.fill('form input', "Airtel phone 1"); await page.locator("form button.btn.primary").click();
  await page.waitForSelector(".msg.warn .mono");
  const keyTxt = await page.locator(".msg.warn .mono").nth(1).textContent();
  check("registering an SMS phone shows its key once (64 hex)", /^[0-9a-f]{64}$/.test(keyTxt ?? ""));
  await page.click('nav.side a[href="/app/owner/users"]'); await page.waitForSelector("text=mayi@example.mw");
  check("owner sees the newly registered parent", true);
  await page.click('nav.side a[href="/app/owner/revenue"]'); await page.waitForSelector('input[type=number]');
  check("revenue defaults 30% / 30%", (await page.locator('input[type=number]').nth(0).inputValue()) === "30" && (await page.locator('input[type=number]').nth(1).inputValue()) === "30");
  await ctx.close();

  // 4. institution: review applicant, view credential, accept
  ({ ctx, page } = await fresh());
  await login(page, "school@enrolla.test", true);
  await page.click('nav.side a[href="/app/institution/applications"]');
  await page.waitForSelector("text=Chikondi Banda");
  await page.click("text=Open");
  await page.waitForSelector("text=MSCE Certificate 2024");
  check("institution sees applicant parent/statement/credentials", (await page.locator("body").innerText()).includes("farmers"));
  const [popup] = await Promise.all([ctx.waitForEvent("page"), page.getByRole("button", { name: "View", exact: true }).first().click()]);
  await popup.waitForURL(/\/v1\/files\/get\//, { timeout: 10000 });
  await popup.waitForLoadState();
  const fileResp = await ctx.request.get(popup.url());
  check("credential opens via signed URL (PDF bytes, content-type pdf)", (await fileResp.text()).includes("%PDF") && (fileResp.headers()["content-type"] ?? "").includes("pdf"), fileResp.headers()["content-type"]);
  await popup.close();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Accept/ }).click({ timeout: 8000 }).catch(async () => { console.log("BUTTONS:", JSON.stringify(await page.locator("button").evaluateAll((bs) => bs.map((b) => [b.innerText, b.disabled])))); console.log("MSG:", (await page.locator(".msg").allInnerTexts()).join(" | ")); throw new Error("accept click"); });
  await page.waitForSelector(".badge:has-text('Accepted')", { timeout: 10000 }).catch(async () => { console.log("PAGE TEXT:", (await page.locator(".main").innerText()).slice(0, 600)); throw new Error("accept"); });
  check("applicant accepted; seat counted", true);
  check("only one nav item is highlighted", (await page.locator("nav.side a.on").count()) === 1);
  await page.screenshot({ path: `${SHOTS}/institution-applicant.png`, fullPage: true });
  await page.click('nav.side a[href="/app/institution/whatsapp"]'); await page.waitForSelector("text=Not linked");
  await page.getByRole("button", { name: /Link WhatsApp/ }).click();
  await page.waitForSelector(".badge:has-text('Starting')");
  check("WhatsApp link requested (wa-worker not running here -> stays Starting)", true);
  await page.click('nav.side a[href="/app/institution/programs"]'); await page.waitForSelector("text=1 of 30 seats taken");
  check("programme shows seat taken", true);
  await ctx.close();

  // 5. student (Chichewa preference from account) sees the decision
  ({ ctx, page } = await fresh());
  await login(page, "student@enrolla.test");
  await page.click('nav.side a[href="/app/family/applications"]');
  await page.waitForSelector(".badge");
  const txt = await page.locator("main, .main").innerText();
  check("student UI follows account language (Chichewa) and shows 'Mwalandiridwa'", txt.includes("Zopempha zanga") && txt.includes("Mwalandiridwa"));
  await page.screenshot({ path: `${SHOTS}/student-ny.png` });
  await ctx.close();

  // 6. phone-sized screen, Tumbuka
  const mctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true });
  const m = await mctx.newPage();
  await m.goto(BASE + "/login"); await m.getByRole("button", { name: "Chitumbuka" }).click();
  check("no horizontal scroll on a phone", await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  check("all three language buttons fully visible on a phone", await m.evaluate(() => [...document.querySelectorAll(".lang")].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; })));
  await m.screenshot({ path: `${SHOTS}/login-mobile-tum.png` });
  await mctx.close();
} catch (e) { check("UNEXPECTED: " + e.message.split("\n")[0], false); }
await browser.close();
check("no JS errors in any page", errors.length === 0, errors.filter((e) => e.startsWith("HTTP") || e.startsWith("pageerror")).join(" || ").slice(0, 1500) || errors.join(" || ").slice(0, 600));
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} passed`);
process.exit(results.every((r) => r[0]) ? 0 : 1);
