import * as OTPAuth from "otpauth";
import { decrypt, encrypt } from "./crypto.js";

const make = (secretB32: string, label: string) =>
  new OTPAuth.TOTP({ issuer: "Enrolla", label, algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secretB32) });

export function newSecret(label: string) {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  return { secret, stored: encrypt(secret), otpauthUrl: make(secret, label).toString() };
}
// Accepts the previous/next 30 s window to tolerate clock drift.
export const verifyCode = (stored: string, code: string) => make(decrypt(stored), "x").validate({ token: code.replace(/\s/g, ""), window: 1 }) !== null;
export const currentCode = (secretB32: string) => make(secretB32, "x").generate(); // tests only
