import { API } from "./config";
import { secret } from "./kv";
import { setDiagReporter, stage } from "./diag";
import { File as PhoneFile } from "expo-file-system";
import { markOffline, markOnline } from "./net";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public body?: any) { super(code); }
}

let access: string | null = null;
let refreshing: Promise<"ok" | "denied" | "offline"> | null = null;
let onSignedOut: () => void = () => {};
export const setOnSignedOut = (f: () => void) => { onSignedOut = f; };
export const hasAccessToken = () => !!access;
export const getAccessToken = () => access;

export async function storeTokens(a: string, r?: string) { access = a; if (r) await secret.set("rt", r); }
export async function clearTokens() { access = null; await secret.del("rt"); }
export const hasRefreshToken = async () => !!(await secret.get("rt"));

const timed = (url: string, init: RequestInit, ms = 20_000) => {
  const c = new AbortController(); const timer = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...init, signal: c.signal }).then((r) => { if (url.startsWith(API)) markOnline(); return r; }, (e) => { if (url.startsWith(API)) markOffline(); throw e; }).finally(() => clearTimeout(timer));
};

// Refresh tokens rotate: every refresh returns a new one that must replace the old (re-using an old one signs the account out).
export function refresh(): Promise<"ok" | "denied" | "offline"> {
  refreshing ??= (async () => {
    const rt = await secret.get("rt");
    if (!rt) return "denied" as const;
    try {
      const r = await timed(`${API}/v1/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: rt }) });
      if (r.status === 401) { await clearTokens(); onSignedOut(); return "denied" as const; }
      if (!r.ok) return "offline" as const;
      const d = await r.json(); await storeTokens(d.accessToken, d.refreshToken); return "ok" as const;
    } catch { return "offline" as const; }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function raw(path: string, init: RequestInit, ms?: number) {
  return timed(`${API}/v1${path}`, { ...init, headers: { ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(access && { Authorization: `Bearer ${access}` }), ...(init.headers as object) } }, ms);
}

export async function api<T = any>(path: string, init: RequestInit = {}, ms?: number): Promise<T> {
  let r: Response;
  if (!access) await refresh();
  try { r = await raw(path, init, ms); } catch { throw new ApiError(0, "network"); }
  if (r.status === 401 && (await refresh()) === "ok") { try { r = await raw(path, init, ms); } catch { throw new ApiError(0, "network"); } }
  if (!r.ok) { const b = await r.json().catch(() => null); throw new ApiError(r.status, b?.error ?? "internal", b); }
  const ct = r.headers.get("content-type") ?? "";
  return (r.status === 204 ? undefined : ct.includes("json") ? await r.json() : await r.text()) as T;
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const put = <T = any>(path: string, body: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });

// Login/signup do not need (and must not send) a bearer token.
export async function authCall(path: "login" | "signup", body: unknown) {
  let r: Response;
  try { r = await timed(`${API}/v1/auth/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); } catch { throw new ApiError(0, "network"); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, d.error ?? "internal", d);
  if (d.accessToken) await storeTokens(d.accessToken, d.refreshToken);
  return d;
}

export async function logoutRemote() {
  const rt = await secret.get("rt");
  if (rt) await timed(`${API}/v1/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: rt }) }, 5000).catch(() => {});
}

// fetch() cannot open some Android file:// paths (names with %, spaces or non-ASCII give a 404), so read through the file system module.
async function readPicked(uri: string): Promise<ArrayBuffer> {
  try { return await new PhoneFile(uri).arrayBuffer(); }
  catch (first) {
    try { const r = await fetch(uri); if (r.ok || r.status === 0) return await r.arrayBuffer(); } catch { /* fall through */ }
    throw first;
  }
}

export interface Picked { uri: string; name: string; mime: string; size?: number }
// Direct-to-storage upload: signed URL from the API, PUT the bytes, then confirm. Needs a connection (not queued).
const LIMIT: Record<string, number> = { "application/pdf": 10_000_000, "image/jpeg": 12_000_000, "image/png": 12_000_000 };
export async function uploadPicked(urlPath: string, confirmPath: string, f: Picked, extra: Record<string, unknown> = {}) {
  const meta = { mime: f.mime, size: f.size };
  if (!(f.mime in LIMIT)) throw new ApiError(400, "file_type_not_allowed");
  const bytes = await stage("read-file", () => readPicked(f.uri), meta);
  if (bytes.byteLength > LIMIT[f.mime]!) throw new ApiError(400, "file_too_large");
  const sha = await stage("checksum", () => sha256Hex(bytes), meta);
  const slot = await stage("get-link", () => post(urlPath, { mime: f.mime, size: bytes.byteLength, ...extra }), meta);
  await stage("send-file", async () => {
    let up: Response;
    try { up = await timed(slot.url, { method: "PUT", headers: slot.headers, body: bytes }, 120_000); } catch (e) { throw new Error(`cannot reach ${slot.url.slice(0, 60)}: ${e instanceof Error ? e.message : e}`); }
    if (!up.ok) throw new ApiError(up.status, (await up.json().catch(() => ({})) as any).error ?? "upload_failed");
  }, meta);
  return stage("save", () => post(confirmPath, { key: slot.key, sha256: sha, mime: f.mime, size: bytes.byteLength, ...extra }), meta);
}

async function sha256Hex(buf: ArrayBuffer) {
  const { digest, CryptoDigestAlgorithm } = await import("expo-crypto");
  const d = await digest(CryptoDigestAlgorithm.SHA256, buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

setDiagReporter((b) => post("/me/diag", b));
