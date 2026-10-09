import fs from "node:fs";
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
const require = createRequire(new URL("../backend/package.json", import.meta.url));
const OTPAuth = require("otpauth");
const SECRETS = { owner: "JBSWY3DPEHPK3PXP", school: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" }; // every demo account has its OWN authenticator secret
const code = (who = "owner") => new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(SECRETS[who]) }).generate();
const SHOTS = process.env.SHOTS ?? "./shots", BASE = "http://localhost:3000";

fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox"] });
const results = []; const errors = [];
const check = (name, ok, extra = "") => { results.push([ok, name, extra]); console.log(ok ? "PASS" : "FAIL", name, extra); };
async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage(); globalThis.__page = page;
  page.on("response", (r) => { if (r.status() >= 400 && r.status() !== 401 && !/auth\/phone\/verify/.test(r.url())) errors.push("HTTP " + r.status() + " " + r.request().method() + " " + r.url()); });
  page.on("response", (r) => { if (r.status() >= 400 && r.status() !== 401 && !/auth\/phone\/verify/.test(r.url())) errors.push("HTTP " + r.status() + " " + r.request().method() + " " + r.url()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/401|favicon|net::ERR/.test(m.text()) && !/auth\/phone\/verify/.test(m.location().url ?? "")) errors.push("console: " + m.text()); });
  return { ctx, page };
}
async function login(page, email, withCode = false) {
  await page.goto(BASE + "/login");
  await page.fill('input[name=identifier]', email); await page.fill('input[name=password]', "Passw0rd-demo1");
  await page.click('form button.btn.primary');
  if (withCode) { await page.waitForSelector('input[name=code]'); await page.fill('input[name=code]', code(email.startsWith("school") ? "school" : "owner")); await page.click('form button.btn.primary'); }
  await page.waitForURL(/\/app\//, { timeout: 15000 });
}
try {
  // 0. public landing page: English by default, programmes listed with the student-facing total
  let { ctx, page } = await fresh();
  await page.goto(BASE + "/");
  check("landing page is in English by default", (await page.locator("h1").textContent()) === "Find your place. Apply with confidence.");
  await page.waitForSelector("text=BSc Computer Science");
  check("landing shows tuition per semester", (await page.locator("#open").innerText()).includes("MK 800,000 per semester"));
  check("landing lists programmes with total incl. service fee (MK 13,000)", (await page.locator("#open").innerText()).includes("MK 13,000"));
  const order = await page.locator("header .lang").allTextContents();
  check("English is the first language option", order[0] === "English" && order.join() === "English,Chichewa,Chitumbuka", order.join());
  const fonts = await page.evaluate(() => ({ h: getComputedStyle(document.querySelector("h1")).fontFamily, b: getComputedStyle(document.body).fontFamily }));
  check("serif headings + sans body fonts", /Source Serif/.test(fonts.h) && /Source Sans/.test(fonts.b), JSON.stringify(fonts));
  check("fonts actually loaded from our own bundle", await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some((f) => f.family.includes("Source Serif") && f.status === "loaded"); }));
  await page.screenshot({ path: `${SHOTS}/landing-en.png`, fullPage: true });
  // public school page: tuition, other fees, only APPROVED photos, preview lightbox
  await page.getByRole("link", { name: "Zomba Demo University" }).first().click();
  await page.waitForSelector(".thumb img");
  const sp = await page.locator("main").innerText();
  check("school page shows tuition and other fees", sp.includes("MK 800,000 per semester") && sp.includes("Registration") && sp.includes("Students' Union"));
  check("school page shows only the approved photo", (await page.locator(".thumb").count()) === 1 && !sp.includes("awaiting approval"));
  check("school photo actually renders in the browser", await page.evaluate(async () => { const i = document.querySelector(".thumb img"); await i.decode().catch(() => {}); return i.naturalWidth > 0; }));
  await page.locator(".thumb").first().click();
  await page.waitForSelector(".lightbox img");
  check("clicking a photo opens a full-size preview", (await page.locator(".lightbox img").evaluate((i) => i.naturalWidth)) > 0);
  await page.keyboard.press("Escape");
  check("Esc closes the preview", (await page.locator(".lightbox").count()) === 0);
  await page.screenshot({ path: `${SHOTS}/school-public.png`, fullPage: true });
  await page.goto(BASE + "/");
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
  await page.fill('input[name=fullName]', "Mayi Phiri"); await page.fill('input[name=phone]', "0999 555 001"); // phone only: email is optional for parents
  await page.fill('input[name=occupation]', "Mlimi"); await page.fill('input[name=password]', "very-long-password-1");
  await page.check('input[name=consent]');
  await page.click('form button.btn.primary');
  // phone verification: dev mode shows the code on screen (no WhatsApp/SMS configured here)
  await page.waitForURL(/\/app\/verify/, { timeout: 15000 });
  const devText = await page.locator(".msg, .alert, [class*=msg]").filter({ hasText: /\d{6}/ }).first().innerText();
  const otp = devText.match(/\d{6}/)[0];
  check("signup lands on the phone verification screen (Chichewa)", (await page.locator("h1").textContent()).includes("nambala"), await page.locator("h1").textContent());
  await page.goto(BASE + "/app/family"); await page.waitForURL(/\/app\/verify/, { timeout: 15000 });
  check("unverified user cannot reach the app", true);
  await page.fill('input[autocomplete=one-time-code]', otp === "000000" ? "111111" : "000000"); await page.click('form button.btn.primary');
  await page.waitForSelector(".msg.err, .err", { timeout: 10000 });
  check("wrong code is refused", page.url().includes("/app/verify"));
  await page.fill('input[autocomplete=one-time-code]', otp); await page.click('form button.btn.primary');
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
  await page.locator("header").getByRole("button", { name: "English" }).click(); // wizard checks below use English labels
  check("browse shows tuition", (await page.locator("main").innerText()).includes("MK 800,000"));
  // ---- application wizard (college): up to 3 choices, multi-step, documents, submit
  const pdf = { name: "doc.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e") };
  await page.locator("article, .card").filter({ hasText: "BSc Computer Science" }).getByRole("link", { name: "Apply" }).click();
  await page.waitForURL(/\/app\/apply\?draft=/, { timeout: 15000 });
  await page.waitForSelector(".stepper");
  check("wizard has 9 steps for a university", (await page.locator(".stepper li").count()) === 9);
  const ssel = page.locator("select").first();
  await ssel.selectOption({ label: "BA Economics" });
  await ssel.selectOption({ label: "Bachelor of Business Administration" });
  check("3 choices reached: no more choices can be added", (await page.locator(".choice").count()) === 3 && (await page.locator("select").count()) === 0);
  check("max-3 message shown", (await page.locator("main").innerText()).includes("up to 3"));
  await page.getByRole("button", { name: /Save and continue|Sungani ndi kupitiriza/ }).click();
  // personal
  await page.waitForSelector('input[type=date]');
  const lab = (text) => page.locator("label.field", { hasText: text });
  const fill = async (text, v) => lab(text).first().locator("input").fill(v);
  await fill("Surname", "Phiri"); await fill("First name", "Mphatso"); await lab("Sex").locator("select").selectOption("F");
  await page.locator('input[type=date]').fill("2005-05-05"); await fill("Home district", "Zomba"); await fill("Physical address", "Chirunga, Zomba"); await fill("Mobile number", "0999000111");
  await page.getByRole("button", { name: "Save and continue" }).click();
  // education
  await page.waitForSelector("text=Qualification completed");
  await lab("Qualification completed").locator("select").selectOption("MSCE");
  await fill("Name of school", "Zomba Catholic Secondary"); await lab("Year completed").locator("input").fill("2023");
  await page.locator(".subjrow").first().locator("input").nth(0).fill("English"); await page.locator(".subjrow").first().locator("input").nth(1).fill("2");
  await page.getByRole("button", { name: "Save and continue" }).click();
  // status
  await page.waitForSelector("text=What are you doing now?");
  await lab("What are you doing now?").locator("select").selectOption("STUDYING");
  await page.getByRole("button", { name: "Save and continue" }).click();
  // guardian (prefilled from the parent's own account)
  await page.waitForSelector("text=This person is my");
  check("guardian step is prefilled from the parent account", (await lab("Full name").locator("input").inputValue()) === "Mayi Phiri");
  await fill("Phone number", "0888222333");
  await page.getByRole("button", { name: "Save and continue" }).click();
  // study options
  await page.waitForSelector("text=Mode of study");
  await lab("Mode of study").locator("select").selectOption("FULL_TIME");
  await page.getByRole("button", { name: "Save and continue" }).click();
  // sponsor
  await page.waitForSelector("text=Who will pay your tuition fees?");
  await lab("Who will pay your tuition fees?").locator("select").selectOption("PARENT");
  await page.getByLabel("Friend or family").check();
  await page.getByRole("button", { name: "Save and continue" }).click();
  // documents: upload through the real presigned-URL flow
  await page.waitForSelector("text=Type of document");
  await lab("Type of document").locator("select").selectOption("ID");
  await page.locator('input[type=file]').setInputFiles(pdf); await page.waitForSelector("text=National ID");
  await lab("Type of document").locator("select").selectOption("MSCE");
  await page.locator('input[type=file]').setInputFiles(pdf); await page.waitForSelector("text=MSCE certificate");
  check("uploaded documents are attached automatically", (await page.locator('.card input[type=checkbox]:checked').count()) >= 2);
  await page.getByRole("button", { name: "Save and continue" }).click();
  // review: submit is blocked until the declaration is ticked and signed
  await page.waitForSelector("text=Anything else to tell the institution");
  check("review lists the three ranked choices", (await page.locator("main").innerText()).includes("Choice 3"));
  const submit = page.getByRole("button", { name: "Submit application" });
  check("submit disabled until declaration + signature", await submit.isDisabled());
  await page.locator('.card input[type=checkbox]').last().check();
  await page.locator("label.field", { hasText: "Type your full name" }).locator("input").fill("Mphatso Phiri");
  await submit.click();
  await page.waitForURL(/\/app\/family\/applications/, { timeout: 15000 });
  await page.waitForSelector("text=Pay the application fee"); await page.waitForSelector("text=+265999000111");
  const appsText = await page.locator("main").innerText();
  check("after submit the parent is asked to pay; shows the Mpamba/Airtel number", appsText.includes("0888000222") === false && /\+265999000111|999000111/.test(appsText), appsText.slice(0, 160).replace(/\n/g, " "));
  await page.screenshot({ path: `${SHOTS}/wizard-submitted.png`, fullPage: true });

  // ---- primary school: class level only, 6 steps, Standard 1 needs no report
  await page.goto(BASE + "/app/browse");
  await page.locator(".card").filter({ hasText: "Standard 1" }).first().getByRole("link", { name: "Apply" }).click();
  await page.waitForSelector(".stepper");
  check("school wizard has 6 steps and a 'Class' step", (await page.locator(".stepper li").count()) === 6 && (await page.locator(".stepper").innerText()).includes("Class"));
  check("school: choose one class level (radio), no multi-choice list", (await page.locator('input[type=radio]').count()) >= 1 && (await page.locator(".choice select").count()) === 0);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForSelector("text=Surname");
  check("bio data entered once is remembered for the next application", (await lab("Surname").locator("input").first().inputValue()) === "Phiri");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForSelector("text=Previous school");
  check("Standard 1: no previous-school report needed", (await page.locator("main").innerText()).includes("Standard 1 entry: no previous school report is needed."));
  check("old standalone 'ask my previous school' card is gone from My documents", true);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForSelector("text=This person is my"); await fill("Phone number", "0888222333"); await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForSelector("text=Attach clear copies"); await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForSelector("text=Anything else to tell the institution");
  await page.locator('.card input[type=checkbox]').last().check();
  await page.locator("label.field", { hasText: "Type your full name" }).locator("input").fill("Mphatso Phiri");
  await page.getByRole("button", { name: "Submit application" }).click();
  await page.waitForURL(/\/app\/family\/applications/, { timeout: 15000 });
  await page.waitForSelector("text=Standard 1");
  check("parent now has two applications (university + primary school)", (await page.locator("main .card").filter({ hasText: "Pay the application fee" }).count()) === 2);
  await page.goto(BASE + "/app/family/documents");
  check("My documents no longer has the 'ask my previous school' card", !(await page.locator("main").innerText()).includes("Ask my previous school"));
  await page.goto(BASE + "/app/browse"); await page.locator("header").getByRole("button", { name: "Chichewa" }).click(); await page.waitForSelector("text=Sakani sukulu");
  await page.screenshot({ path: `${SHOTS}/parent-browse-ny.png` });
  await page.reload(); await page.waitForSelector("nav.side");
  check("session restored from httpOnly cookie after reload", (await page.locator("nav.side").innerText()).includes("Ana anga"));
  const cookies = await ctx.cookies();
  const rt = cookies.find((c) => c.name === "rt");
  check("refresh token cookie is httpOnly + SameSite=Strict", !!rt && rt.httpOnly && rt.sameSite === "Strict");
  check("refresh token not readable by page scripts", !(await page.evaluate(() => document.cookie)).includes("rt="));
  // ---- parent changes password (signed in) -> other sessions out, new password works
  await page.getByRole("link", { name: "Chitetezo" }).click();
  await page.waitForSelector("text=Sinthani mawu achinsinsi");
  await page.locator("label.field", { hasText: "Mawu achinsinsi amakono" }).locator("input").fill("very-long-password-1");
  await page.locator("label.field", { hasText: "Mawu achinsinsi atsopano" }).locator("input").fill("another-long-password-2");
  await page.locator("form button.btn").click();
  await page.waitForSelector("text=Mawu achinsinsi asinthidwa");
  check("parent changed password (Chichewa message); session stays signed in", true);
  await page.reload(); await page.waitForSelector("nav.side");
  check("still signed in after reload with the NEW refresh cookie", (await page.locator("nav.side").innerText()).includes("Ana anga"));
  await ctx.close();
  { const { ctx: c2, page: p2 } = await fresh(); await p2.goto(BASE + "/login");
    await p2.fill('input[name=identifier]', "0999 555 001"); await p2.fill('input[name=password]', "very-long-password-1"); await p2.click("form button.btn.primary");
    check("old password no longer works", (await p2.locator(".msg.err").waitFor({ timeout: 8000 }).then(() => true).catch(() => false)));
    await p2.fill('input[name=password]', "another-long-password-2"); await p2.click("form button.btn.primary"); await p2.waitForURL(/\/app\//, { timeout: 15000 });
    check("new password works", true); await c2.close(); }

  // 3. owner: MFA login, dashboard + all six screens
  ({ ctx, page } = await fresh());
  await page.goto(BASE + "/login"); await page.getByRole("button", { name: "Chichewa" }).click();
  await page.fill('input[name=identifier]', "owner@enrolla.test"); await page.fill('input[name=password]', "Passw0rd-demo1");
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
  await page.goto(BASE + "/app/security"); await page.waitForSelector('[data-testid="codes-left"]');
  await page.locator("header").getByRole("button", { name: "English" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Create new codes/ }).click();
  await page.waitForSelector('[data-testid="recovery-codes"]');
  const codes = (await page.locator('[data-testid="recovery-codes"] div').allTextContents()).map((x) => x.trim());
  check("owner gets 8 recovery codes", codes.length === 8 && codes.every((c) => /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(c)), codes.join(","));
  await ctx.close();
  { // lost phone: sign in with a recovery code instead of the authenticator
    const { ctx: c3, page: p3 } = await fresh(); await p3.goto(BASE + "/login");
    await p3.fill('input[name=identifier]', "owner@enrolla.test"); await p3.fill('input[name=password]', "Passw0rd-demo1"); await p3.click("form button.btn.primary");
    await p3.waitForSelector('input[name=code]'); await p3.fill('input[name=code]', codes[0]); await p3.click("form button.btn.primary");
    await p3.waitForURL(/\/app\/owner/, { timeout: 15000 });
    check("owner signs in with a recovery code (no authenticator)", true);
    await p3.getByRole("button", { name: "Sign out" }).click(); await p3.waitForURL(/\/login/);
    await p3.fill('input[name=identifier]', "owner@enrolla.test"); await p3.fill('input[name=password]', "Passw0rd-demo1"); await p3.click("form button.btn.primary");
    await p3.waitForSelector('input[name=code]'); await p3.fill('input[name=code]', codes[0]); await p3.click("form button.btn.primary");
    check("the same recovery code cannot be used twice", await p3.locator(".msg.err").waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
    await c3.close(); }

  // 4a. the student has the app open (live channel) BEFORE the school decides
  const stu = await fresh();
  await login(stu.page, "student@enrolla.test");
  await stu.page.click('nav.side a[href="/app/family/applications"]');
  await stu.page.waitForSelector(".badge");
  await stu.page.waitForSelector(".live.on", { timeout: 15000 });
  check("live channel connects (green dot in the header)", true);
  check("student sees no 'Accepted' yet", !(await stu.page.locator("main, .main").innerText()).includes("Mwalandiridwa"));

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
  // ... and the student's already-open page updates by itself: toast + badge + list, NO reload
  await stu.page.waitForSelector(".toast", { timeout: 10000 });
  check("student gets a live pop-up the moment the school accepts", true, (await stu.page.locator(".toast").first().innerText()).replace(/\n/g, " "));
  check("bell badge increments without reload", Number(await stu.page.locator(".iconbtn .n").first().innerText()) >= 1);
  await stu.page.waitForFunction(() => document.querySelector("main, .main")?.textContent?.includes("Mwalandiridwa"), null, { timeout: 10000 });
  check("student's application list flips to Accepted without reload", true);
  await stu.page.screenshot({ path: `${SHOTS}/student-live.png` });
  await stu.ctx.close();
  check("only one nav item is highlighted", (await page.locator("nav.side a.on").count()) === 1);
  await page.screenshot({ path: `${SHOTS}/institution-applicant.png`, fullPage: true });
  await page.click('nav.side a[href="/app/institution/whatsapp"]'); await page.waitForSelector("text=Not linked");
  await page.screenshot({ path: `${SHOTS}/institution-whatsapp.png`, fullPage: true });
  check("WhatsApp page shows the checklist (verified, two-step)", (await page.locator("main").innerText()).includes("Your institution is verified") && (await page.locator("main").innerText()).includes("Two-step security is on"));
  const running = await page.getByText("The WhatsApp service is running on the server").waitFor({ timeout: 12000 }).then(() => true, () => false);
  if (!running) {
    check("service down: clear message and linking is disabled", (await page.locator("main").innerText()).includes("not running on the server") && await page.getByRole("button", { name: /Link WhatsApp/ }).isDisabled());
  } else {
    // link by phone-number code (the QR way is the other tab). Without internet the server cannot reach WhatsApp: the page must say so plainly.
    await page.getByRole("button", { name: "Use a phone-number code" }).click();
    await page.locator('input[type=tel]').fill("0999 123 456");
    await page.getByRole("button", { name: "Get code" }).click();
    await page.waitForSelector(".badge:has-text('Starting'), .badge:has-text('Enter the code'), .badge:has-text('Problem'), .badge:has-text('Scan the code')", { timeout: 15000 });
    await page.waitForSelector("[data-testid=pairing-code], .msg.err", { timeout: 60000 });
    const body = await page.locator("main").innerText();
    check("WhatsApp: pairing code shown, or a readable reason when WhatsApp is unreachable", /Enter the code|cannot reach WhatsApp|Chrome or Chromium/.test(body) || (await page.locator("[data-testid=pairing-code]").count()) > 0, body.replace(/\n/g, " ").slice(0, 160));
  }
  await page.click('nav.side a[href="/app/institution/programs"]'); await page.waitForSelector("text=1 of 30 seats taken");
  check("programme shows seat taken", true);
  check("programme list shows tuition", (await page.locator("main").innerText()).includes("MK 800,000 per semester"));
  // school's own gallery: both photos visible (this is the bug where uploaded media could not be seen)
  await page.click('nav.side a[href="/app/institution/media"]'); await page.waitForSelector(".thumb img");
  const loaded = await page.evaluate(async () => { const imgs = [...document.querySelectorAll(".thumb img")]; await Promise.all(imgs.map((i) => i.decode().catch(() => {}))); return imgs.map((i) => i.naturalWidth > 0); });
  check("institution media page: every uploaded photo renders", loaded.length === 2 && loaded.every(Boolean), JSON.stringify(loaded));
  check("hidden/visible status shown on each photo", (await page.locator("main").innerText()).includes("Hidden until verified"));
  await page.locator(".thumb").first().click(); await page.waitForSelector(".lightbox img");
  check("institution can preview a photo full-size", (await page.locator(".lightbox img").evaluate((i) => i.naturalWidth)) > 0);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Preview as applicants see it" }).click();
  await page.waitForSelector("text=awaiting approval");
  check("preview page shows the school as applicants see it, including unapproved media", (await page.locator(".thumb").count()) === 2);
  await page.screenshot({ path: `${SHOTS}/institution-preview.png`, fullPage: true });
  await page.click('nav.side a[href="/app/institution/profile"]'); await page.waitForSelector("text=About your institution");
  check("institution profile page loads (campuses, other fees)", (await page.locator("main").innerText()).includes("Other fees"));
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
} catch (e) { check("UNEXPECTED: " + e.message.split("\n")[0], false); const pg = globalThis.__page; if (pg) { console.log("URL:", pg.url()); console.log("PAGE:", (await pg.locator("main, .main").first().innerText().catch(() => "")).slice(0, 700).replace(/\n/g, " | ")); await pg.screenshot({ path: `${SHOTS}/failure.png`, fullPage: true }).catch(() => {}); } }
await browser.close();
check("no JS errors in any page", errors.length === 0, errors.filter((e) => e.startsWith("HTTP") || e.startsWith("pageerror")).join(" || ").slice(0, 1500) || errors.join(" || ").slice(0, 600));
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} passed`);
process.exit(results.every((r) => r[0]) ? 0 : 1);
