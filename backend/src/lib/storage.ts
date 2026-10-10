import crypto, { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

// Optional: only loaded when STORAGE_DRIVER=s3 (the AWS SDK packages are optional dependencies).
let s3Mod: Promise<{ s3: import("@aws-sdk/client-s3").S3Client; S3: typeof import("@aws-sdk/client-s3"); sign: typeof import("@aws-sdk/s3-request-presigner").getSignedUrl }> | undefined;
const aws = () => (s3Mod ??= (async () => { const S3 = await import("@aws-sdk/client-s3"); const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner"); return { s3: new S3.S3Client({ region: config.S3_REGION }), S3, sign: getSignedUrl }; })());
const local = config.STORAGE_DRIVER === "local";

const ALLOWED: Record<string, number> = {
  "application/pdf": 10_000_000,
  "image/jpeg": 12_000_000, // phone photos are often 5-10 MB; the apps also shrink them before sending
  "image/png": 12_000_000,
  "video/mp4": 200_000_000,
};

// Links for the local driver must point at the address the CALLER used to reach the API (a phone on the LAN cannot reach "localhost"),
// so the request's own origin wins; PUBLIC_API_URL is only the fallback for background jobs.
const origin = new AsyncLocalStorage<string>();
export const rememberOrigin: RequestHandler = (req, _res, next) => origin.run(`${req.protocol}://${req.get("host")}`, next);
const apiBase = () => origin.getStore() ?? config.PUBLIC_API_URL;

// ---- local driver: HMAC-signed, expiring URLs served by routes/files.ts (dev & tests only) ----
const sign = (payload: object) => {
  const b = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${b}.${crypto.createHmac("sha256", config.JWT_ACCESS_SECRET).update(b).digest("base64url")}`;
};
export function verifyLocalToken(token: string): { op: "put" | "get"; key: string; mime?: string; size?: number } | null {
  const [b, mac] = token.split(".");
  if (!b || !mac) return null;
  const good = crypto.createHmac("sha256", config.JWT_ACCESS_SECRET).update(b).digest("base64url");
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  const p = JSON.parse(Buffer.from(b, "base64url").toString());
  return p.exp > Date.now() ? p : null;
}
const localPath = (key: string) => {
  const root = path.resolve(config.LOCAL_STORAGE_DIR), full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("bad key");
  return full;
};
export async function localWrite(key: string, data: Buffer, mime = "application/octet-stream") {
  const f = localPath(key); await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, data); await fs.writeFile(f + ".mime", mime); // sidecar so dev downloads get the right Content-Type, like S3
}
export const localRead = (key: string) => fs.readFile(localPath(key));
export const localMime = (key: string) => fs.readFile(localPath(key) + ".mime", "utf8").catch(() => "application/octet-stream");

// Clients upload straight to the private bucket (keeps 70k users' bytes off the API servers).
// Content-type and size are pinned in the signature. A malware-scan Lambda should gate `quarantine/` -> live key.
// An error the API turns into a normal 4xx answer (instead of a bare 500).
export class HttpError extends Error { constructor(public status: number, public code: string) { super(code); } }

export async function presignUpload(prefix: string, mime: string, size: number) {
  const max = ALLOWED[mime];
  if (!max) throw new HttpError(400, "file_type_not_allowed");
  if (size > max) throw new HttpError(400, "file_too_large");
  const key = `${prefix}/${randomUUID()}`;
  if (local) return { key, url: `${apiBase()}/v1/files/put/${sign({ op: "put", key, mime, size, exp: Date.now() + 300_000 })}`, headers: { "Content-Type": mime } };
  const { s3, S3, sign: signUrl } = await aws();
  const url = await signUrl(s3, new S3.PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, ContentType: mime, ContentLength: size }), { expiresIn: 300 });
  return { key, url, headers: { "Content-Type": mime } };
}

export async function presignDownload(key: string, seconds = 120) {
  if (local) return `${apiBase()}/v1/files/get/${sign({ op: "get", key, exp: Date.now() + seconds * 1000 })}`;
  const { s3, S3, sign: signUrl } = await aws();
  return signUrl(s3, new S3.GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), { expiresIn: seconds });
}

// Server-side writes (generated letters).
export async function putObject(key: string, data: Buffer, mime: string) {
  if (local) return localWrite(key, data, mime);
  const { s3, S3 } = await aws();
  await s3.send(new S3.PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: data, ContentType: mime }));
}

export async function getObject(key: string): Promise<Buffer> {
  if (local) return localRead(key);
  const { s3, S3 } = await aws();
  const r = await s3.send(new S3.GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}
