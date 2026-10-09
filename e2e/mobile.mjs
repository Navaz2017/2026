// End-to-end test of the mobile app, run as its web build (react-native-web) in Chromium against the REAL API.
// What this proves: the app's screens, API calls, OTP verification, wizard, offline queue and payment flow work.
// What it cannot prove: native behaviour on a phone (keychain, file picker UI, push, iOS/Android layout quirks).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
const OTPAuth = createRequire(new URL("../backend/package.json", import.meta.url))("otpauth");
const totp = () => new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32("JBSWY3DPEHPK3PXP") }).generate();

const en = JSON.parse(fs.readFileSync(new URL("../shared/i18n/en.json", import.meta.url), "utf8"));
const ny = JSON.parse(fs.readFileSync(new URL("../shared/i18n/ny.json", import.meta.url), "utf8"));
const T = (k, v = {}) => (en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x]);
const API = "http://localhost:4000", PORT = 8081, BASE = `http://localhost:${PORT}`;
const DIST = new URL("../mobile/dist-web/", import.meta.url).pathname;
const SHOTS = process.env.SHOTS ?? "./shots"; fs.mkdirSync(SHOTS, { recursive: true });

// tiny static server with SPA fallback
const mime = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".json": "application/json", ".ttf": "font/ttf", ".css": "text/css" };
const srv = http.createServer((req, res) => {
  let f = path.join(DIST, decodeURIComponent(new URL(req.url, BASE).pathname));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
  res.writeHead(200, { "Content-Type": mime[path.extname(f)] ?? "application/octet-stream" }).end(fs.readFileSync(f));
}).listen(PORT);

const results = [], errors = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name, extra); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
const hits = {};
page.on("request", (r) => { if (r.url().startsWith(API)) { const k = r.method() + " " + new URL(r.url()).pathname.replace(/[0-9a-f-]{36}/g, ":id"); hits[k] = (hits[k] ?? 0) + 1; } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("response", (r) => { if (r.status() >= 400 && r.status() !== 401 && !/auth\/phone\/verify/.test(r.url())) errors.push("HTTP " + r.status() + " " + r.request().method() + " " + r.url()); });
page.on("console", (m) => { if (false) console.log(m.text().slice(0, 300)); if (m.type() === "error" && !/401|favicon|net::ERR|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });

const btn = (name, o = {}) => page.getByRole("button", { name, exact: true, ...o });
const radio = (name) => page.getByRole("radio", { name, exact: true });
const tid = (id) => page.getByTestId(id);
const go = async (name) => { await btn(name).click(); };
const pick = async (label, option) => { await page.getByRole("button", { name: label, exact: true }).first().click(); await page.getByRole("menuitem", { name: option, exact: true }).click(); };
const pickerLabel = (key) => T(key);
// screens stay mounted (hidden) under the stack on web, so only look at what is visible
const vis = (text) => page.getByText(text).locator("visible=true").first();
const next = async () => { await tid("next").click(); };
const PASSWORD = "mobile-test-pass-1";
const PHONE = "0999 555 777", PHONE_E164 = "+265999555777";

try {
  // ---- 1. language on the sign-in screen: whole screen switches
  await page.goto(BASE);
  await page.getByRole("heading", { name: T("auth.signIn") }).waitFor({ timeout: 30000 });
  await radio("Chichewa").click();
  check("sign-in screen switches to Chichewa", await page.getByRole("heading", { name: ny["auth.signIn"] }).isVisible());
  await page.screenshot({ path: `${SHOTS}/m-login-ny.png` });
  await radio("English").click();

  // ---- 2. sign up with a phone number only, verify it with the code
  await page.getByText(T("auth.signUp"), { exact: true }).last().click();
  await tid("fullName").fill("Mayi Mobile");
  await tid("phone").fill(PHONE);
  await tid("occupation").fill("Teacher");
  await tid("newpw").fill(PASSWORD);
  check("sign-up button stays off until consent is ticked", await btn(T("auth.signUp")).isDisabled());
  await page.getByRole("checkbox").click();
  await btn(T("auth.signUp")).click();
  await page.getByText(/Development mode - your code is \d{6}/).waitFor({ timeout: 15000 });
  const otp = (await page.getByText(/Development mode - your code is \d{6}/).innerText()).match(/\d{6}/)[0];
  check("verification screen shows (dev mode echoes the code)", true, otp);
  await page.screenshot({ path: `${SHOTS}/m-verify.png` });
  await tid("code").fill(otp === "000000" ? "111111" : "000000");
  await tid("submit").click();
  await page.getByText(T("err.invalid_code")).waitFor();
  check("wrong code is refused", true);
  await tid("code").fill(otp);
  await tid("submit").click();
  await page.getByText(T("fam.search")).waitFor({ timeout: 15000 });
  check("correct code opens the app (Find a school)", true);

  // ---- 3. add a child
  await page.getByRole("tab", { name: new RegExp(T("m.account")) }).click();
  await tid("children").click();
  await tid("childName").fill("Chikondi Mobile");
  await tid("childDob").fill("2007-04-02");
  await tid("addChild").click();
  await page.getByText("Chikondi Mobile", { exact: true }).waitFor();
  check("child added", true);
  await page.goBack();

  // ---- 4. browse and open a school page
  await page.getByRole("tab", { name: new RegExp(T("nav.browse")) }).click();
  await page.getByText("BSc Computer Science").first().waitFor({ timeout: 15000 });
  check("programme list shows tuition", (await page.locator("body").innerText()).includes("MK 800,000"));
  await page.getByText("Zomba Demo University · Zomba").first().click();
  await page.getByText(T("sch.programmes")).waitFor();
  check("school page shows programmes, fees and gallery", (await page.locator("body").innerText()).includes(T("sch.gallery")));
  await page.screenshot({ path: `${SHOTS}/m-school.png`, fullPage: true });
  await page.goBack();

  // ---- 5. apply: the whole wizard
  await page.getByTestId(/^apply-/).first().click(); // first listed programme: BSc Computer Science
  await page.getByText(T("wiz.stepOf", { n: 1, total: 9 }), { exact: false }).first().waitFor({ timeout: 20000 });
  check("application draft created, wizard has 9 steps", true);
  await next();
  await tid("surname").fill("Mobile"); await tid("firstName").fill("Chikondi");
  await radio(T("p.male")).click();
  await tid("dob").fill("2007-04-02"); await tid("district").fill("Zomba"); await tid("address").fill("Chirunga, Zomba"); await tid("phone").fill("0999111222");
  await page.screenshot({ path: `${SHOTS}/m-wizard-personal.png`, fullPage: true });
  await next();
  await pick(T("ed.level"), T("qual.MSCE"));
  await tid("eschool").fill("Zomba Secondary"); await tid("eyear").fill("2024");
  await tid("subject0").fill("English"); await tid("grade0").fill("2");
  await next();
  await radio(T("cur.STUDYING")).click(); await next();

  // guardian: typed while OFFLINE -> kept on the phone, then sent when the connection returns
  await tid("gname").waitFor();
  await ctx.setOffline(true);
  await vis(T("common.offline")).waitFor({ timeout: 10000 });
  await tid("gname").fill("Mayi Offline");
  await next();
  await vis(new RegExp(T("m.pending", { n: 1 }).replace(/[()]/g, "\\$&"))).waitFor({ timeout: 15000 });
  check("offline: answers are kept on the phone and the banner says so", true);
  // reading still works from the saved copy
  await page.getByText(T("sy.mode")).first().waitFor();
  await ctx.setOffline(false);
  await vis(new RegExp(T("m.pending", { n: 1 }).replace(/[()]/g, "\\$&"))).waitFor({ state: "detached", timeout: 30000 });
  check("back online: the queued answers are sent automatically", true);
  const tok = (await (await fetch(`${API}/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: PHONE_E164, password: PASSWORD }) })).json()).accessToken;
  const apps = await (await fetch(`${API}/v1/me/applications`, { headers: { Authorization: `Bearer ${tok}` } })).json();
  const draft = await (await fetch(`${API}/v1/me/applications/${apps[0].id}`, { headers: { Authorization: `Bearer ${tok}` } })).json();
  check("server received the guardian section typed offline", draft.form?.guardian?.name === "Mayi Offline", JSON.stringify(draft.form?.guardian));

  await radio(T("mode.FULL_TIME")).click(); await next();             // study
  await pick(T("sp.type"), T("spt.SELF")); await next();               // sponsor
  // documents: upload an ID and a certificate through the file picker
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  for (const kind of ["ID", "MSCE"]) {
    if (kind !== "ID") await pick(T("doc.kind"), T(`dockind.${kind}`));
    const [fc] = await Promise.all([page.waitForEvent("filechooser"), tid("pick").click()]);
    await fc.setFiles({ name: `${kind}.pdf`, mimeType: "application/pdf", buffer: pdf });
    await page.getByRole("checkbox", { name: new RegExp(T(`dockind.${kind}`)) }).first().waitFor({ timeout: 20000 });
  }
  check("documents uploaded from the phone and attached", true);
  await next();
  // review + submit
  await page.getByText(T("rv.noCash")).waitFor();
  await tid("signature").fill("Chikondi Mobile");
  await page.getByRole("checkbox", { name: new RegExp(T("rv.declaration").slice(0, 20)) }).click();
  await page.screenshot({ path: `${SHOTS}/m-review.png`, fullPage: true });
  await tid("submit").click();
  await page.getByText(T("st.app.AWAITING_PAYMENT")).waitFor({ timeout: 20000 });
  check("submitted: application waits for payment", true);

  // ---- 6. pay (Airtel Money reference)
  await tid("reference").fill("TID" + Date.now().toString().slice(-9));
  await tid("payerPhone").fill("0999111222");
  await page.screenshot({ path: `${SHOTS}/m-pay.png`, fullPage: true });
  await tid("paid").click();
  await page.getByText(T("fam.afterPay")).first().waitFor({ timeout: 15000 });
  check("payment reference sent", true);

  // ---- 6b. the owner confirms the payment: the phone hears about it LIVE (no refresh)
  await page.goto(BASE + "/applications");
  await page.getByText("BSc Computer Science").first().waitFor({ timeout: 15000 });
  await page.getByText(T("st.app.PAYMENT_SUBMITTED")).locator("visible=true").first().waitFor();
  await vis(/./).waitFor();
  await page.waitForTimeout(1500); // let the live socket connect
  const ownerTok = (await (await fetch(`${API}/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "owner@enrolla.test", password: "Passw0rd-demo1", code: totp() }) })).json()).accessToken;
  const oh = { Authorization: `Bearer ${ownerTok}`, "Content-Type": "application/json" };
  const pays = await (await fetch(`${API}/v1/admin/payments?status=PENDING`, { headers: oh })).json();
  const mine = pays.find((p) => p.payerPhone?.endsWith("999111222"));
  const conf = await fetch(`${API}/v1/admin/payments/${mine.id}/manual-confirm`, { method: "POST", headers: oh, body: JSON.stringify({ reason: "e2e: SMS did not arrive, checked the Airtel statement" }) });
  check("owner confirms the payment", conf.ok, String(conf.status));
  await page.getByTestId("live-toast").waitFor({ timeout: 10000 });
  check("phone shows a live banner with the news (no refresh)", (await page.getByTestId("live-toast").innerText()).includes(T("notif.PAYMENT_CONFIRMED")));
  await page.screenshot({ path: `${SHOTS}/m-live.png` });
  await page.getByText(T("st.app.SUBMITTED")).locator("visible=true").first().waitFor({ timeout: 10000 });
  check("applications list flips to 'Received by school' by itself", true);
  check("notifications tab shows an unread badge", await page.getByRole("tab", { name: new RegExp(T("nav.notifications")) }).innerText().then((x) => /\d/.test(x)));

  // ---- 7. my applications + offline reading
  await page.goto(BASE + "/applications");
  await page.getByText("BSc Computer Science").first().waitFor({ timeout: 15000 });
  await ctx.setOffline(true);
  await page.getByRole("tab", { name: new RegExp(T("nav.notifications")) }).click();
  await page.getByRole("tab", { name: new RegExp(T("nav.myApps")) }).click();
  await vis(T("common.offline")).waitFor({ timeout: 10000 });
  check("offline: my applications still readable from the saved copy", await page.getByText("BSc Computer Science").first().isVisible());
  await ctx.setOffline(false);

  // ---- 8. sign out wipes the phone's saved data
  await page.getByRole("tab", { name: new RegExp(T("m.account")) }).click();
  await tid("signout").click();
  await page.getByRole("heading", { name: T("auth.signIn") }).waitFor();
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("c:") || k === "outbox" || k === "me" || k === "rt"));
  check("sign out clears cached data and tokens", left.length === 0, JSON.stringify(left));
  // sign back in with the phone number
  await tid("identifier").fill(PHONE); await tid("password").fill(PASSWORD); await tid("submit").click();
  await page.getByText(T("fam.search")).waitFor({ timeout: 15000 });
  check("sign in again with the phone number", true);
} catch (e) {
  console.log("FAIL (exception)", e.message.split("\n").slice(0, 6).join(" | "));
  results.push(false);
  await page.screenshot({ path: `${SHOTS}/m-failure.png`, fullPage: true }).catch(() => {});
  console.log("URL:", page.url(), "\nBODY:", (await page.locator("body").innerText().catch(() => "")).slice(0, 600));
}
console.log("API calls:", JSON.stringify(Object.entries(hits).sort((a, b) => b[1] - a[1]).slice(0, 8)));
check("no JS/network errors", errors.length === 0, errors.slice(0, 5).join(" || "));
await browser.close(); srv.close();
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
