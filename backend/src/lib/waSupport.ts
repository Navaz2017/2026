import path from "node:path";

// Where one WhatsApp session keeps its login and its Chrome profile. whatsapp-web.js' LocalAuth creates
// <WA_DATA_DIR>/session-<key>, so every institution (key = its id) and the platform ("platform") get their OWN folder
// and their OWN Chrome user-data-dir: no cookies, logins or cache are ever shared between institutions.
export const SESSION_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
export function waSessionDir(dataDir: string, key: string) {
  if (!SESSION_KEY_RE.test(key)) throw new Error("invalid session key");
  return path.join(dataDir, `session-${key}`);
}

// Turn the many ways "the browser would not start" into one reason the dashboards can explain.
// Output: "wa_err:<code>" or "wa_err:<code>:<short technical detail>"; anything unrecognised is returned as plain text.
export function classifyWaError(message: string, env: { platform: string; osRelease: string }) {
  const m = message.replace(/\s+/g, " ").trim();
  const detail = m.slice(0, 160);
  const bigSur = env.platform === "darwin" && /^20\./.test(env.osRelease); // macOS 11 = Darwin 20
  if (/ERR_(TUNNEL|INTERNET|NAME_NOT_RESOLVED|CONNECTION|PROXY|TIMED_OUT|ADDRESS)/i.test(m)) return `wa_err:network:${detail}`;
  if (/Could not find|no such file|ENOENT|not found at|executable.*(doesn't|does not) exist/i.test(m)) return `wa_err:no_chrome:${detail}`;
  if (bigSur && /Failed to launch|dyld|Symbol not found|Library not loaded|Target closed|Protocol error|exited|ENOEXEC|Bad CPU/i.test(m)) return `wa_err:mac11:${detail}`;
  if (/Failed to launch|error while loading shared libraries|libnss|libgbm|cannot open shared object/i.test(m)) return `wa_err:chrome_start:${detail}`;
  return m.slice(0, 200);
}

// macOS 11 cannot run Chrome newer than 138. If no Chrome was configured, the one Puppeteer downloads is too new: say so at once.
export const bigSurWithoutChrome = (env: { platform: string; osRelease: string }, chromePath?: string) =>
  env.platform === "darwin" && /^20\./.test(env.osRelease) && !chromePath;
