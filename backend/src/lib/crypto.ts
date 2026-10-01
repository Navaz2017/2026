import crypto from "node:crypto";
import { config } from "../config.js";

export const sha256 = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex");
export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString("base64url");

export function timingSafeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

const key = () => Buffer.from(config.DATA_ENC_KEY, "hex");

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split(".").map((p) => Buffer.from(p, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(enc!), d.final()]).toString("utf8");
}

// Canonical string the SMS-forwarder app signs: timestamp.nonce.sha256(body)
export function deviceSignature(deviceKey: string, timestamp: string, nonce: string, body: string) {
  return crypto.createHmac("sha256", deviceKey).update(`${timestamp}.${nonce}.${sha256(body)}`).digest("hex");
}
