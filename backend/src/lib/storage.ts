import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const s3 = new S3Client({ region: config.S3_REGION });
const local = config.STORAGE_DRIVER === "local";

const ALLOWED: Record<string, number> = {
  "application/pdf": 10_000_000,
  "image/jpeg": 8_000_000,
  "image/png": 8_000_000,
  "video/mp4": 200_000_000,
};

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
export async function presignUpload(prefix: string, mime: string, size: number) {
  const max = ALLOWED[mime];
  if (!max || size > max) throw new Error("File type or size not allowed");
  const key = `${prefix}/${randomUUID()}`;
  if (local) return { key, url: `${config.PUBLIC_API_URL}/v1/files/put/${sign({ op: "put", key, mime, size, exp: Date.now() + 300_000 })}`, headers: { "Content-Type": mime } };
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, ContentType: mime, ContentLength: size }), { expiresIn: 300 });
  return { key, url, headers: { "Content-Type": mime } };
}

export const presignDownload = async (key: string, seconds = 120) =>
  local
    ? `${config.PUBLIC_API_URL}/v1/files/get/${sign({ op: "get", key, exp: Date.now() + seconds * 1000 })}`
    : getSignedUrl(s3, new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), { expiresIn: seconds });

// Server-side writes (generated letters).
export async function putObject(key: string, data: Buffer, mime: string) {
  if (local) return localWrite(key, data, mime);
  await s3.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: data, ContentType: mime }));
}

export async function getObject(key: string): Promise<Buffer> {
  if (local) return localRead(key);
  const r = await s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}
