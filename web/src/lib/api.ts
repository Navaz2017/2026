import { sha256Hex } from "./sha256";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export type Role = "SYSTEM_OWNER" | "INSTITUTION_ADMIN" | "PARENT" | "STUDENT";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public body?: any) { super(code); }
}

let access: string | null = null;
let refreshing: Promise<boolean> | null = null;
export const setAccessToken = (t: string | null) => { access = t; };
export const getAccessToken = () => access;

// Refresh goes through our own Next route handler so the refresh token lives in an httpOnly cookie
// that page scripts (and therefore XSS) can never read.
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST" })
    .then(async (r) => { if (!r.ok) return false; access = (await r.json()).accessToken; return true; })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function raw(path: string, init: RequestInit) {
  return fetch(`${API}/v1${path}`, { ...init, headers: { ...(init.body && !(init.body instanceof Blob) ? { "Content-Type": "application/json" } : {}), ...(access && { Authorization: `Bearer ${access}` }), ...init.headers } });
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  let r: Response;
  try { r = await raw(path, init); } catch { throw new ApiError(0, "network"); }
  if (r.status === 401 && (await refreshSession())) r = await raw(path, init); // access token expired: retry once
  if (!r.ok) { const b = await r.json().catch(() => null); throw new ApiError(r.status, b?.error ?? "internal", b); }
  const ct = r.headers.get("content-type") ?? "";
  return (r.status === 204 ? undefined : ct.includes("json") ? await r.json() : await r.text()) as T;
}

export const post = <T = any>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const put = <T = any>(path: string, body: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });

// Phone photos are often 5-10 MB. Shrink big images (longest side 2400 px, JPEG) before sending: faster on slow networks, and under the limit.
async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1_500_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}
const ALLOWED_UPLOAD = ["application/pdf", "image/jpeg", "image/png"];

// Direct-to-storage upload: ask the API for a signed URL, PUT the bytes, then tell the API about the stored file.
export async function uploadFile(urlPath: string, confirmPath: string, file0: File, extra: Record<string, unknown> = {}) {
  const file = await shrinkImage(file0);
  if (!ALLOWED_UPLOAD.includes(file.type)) throw new ApiError(400, "file_type_not_allowed"); // e.g. iPhone HEIC photos
  const slot = await post(urlPath, { mime: file.type, size: file.size, ...extra });
  const buf = await file.arrayBuffer();
  const sha = await sha256Hex(buf);
  let put: Response;
  try { put = await fetch(slot.url, { method: "PUT", headers: slot.headers, body: buf }); } catch { throw new ApiError(0, "upload_failed"); }
  if (!put.ok) throw new ApiError(put.status, "upload_failed");
  return post(confirmPath, { key: slot.key, sha256: sha, mime: file.type, size: file.size, ...extra });
}

// CSV etc. need the Authorization header, so fetch as blob then save.
export async function downloadBlob(path: string, filename: string) {
  const r = await raw(path, {});
  if (!r.ok) throw new ApiError(r.status, "internal");
  const url = URL.createObjectURL(await r.blob());
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}
