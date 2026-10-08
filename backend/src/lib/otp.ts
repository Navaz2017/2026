import crypto from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { devEcho, sendPlatformMessage, type Channel } from "./messaging.js";

export type OtpPurpose = "SIGNUP" | "RESET";
const TTL_MS = 10 * 60_000, COOLDOWN_MS = config.NODE_ENV === "test" ? 1_000 : 45_000, MAX_PER_HOUR = 5, MAX_ATTEMPTS = 5;

const TEXT: Record<string, string> = {
  en: "Your Enrolla verification code is {code}. It expires in 10 minutes. Never share it with anyone.",
  ny: "Nambala yanu yotsimikizira ya Enrolla ndi {code}. Imatha pakadutsa mphindi 10. Musapereke kwa munthu aliyense.",
  tum: "Nambala yinu yakukhozgera ya Enrolla ni {code}. Yikumara pakapita mphindi 10. Mungapereke kwa munthu waliyose.",
};

const hashCode = (phone: string, purpose: string, code: string) =>
  crypto.createHmac("sha256", config.JWT_REFRESH_SECRET).update(`otp|${phone}|${purpose}|${code}`).digest("hex");

export class OtpError extends Error {
  constructor(public status: number, public code: string, public retryAfter?: number) { super(code); }
}

export async function sendOtp(o: { phone: string; purpose: OtpPurpose; userId?: string; language?: string }) {
  const last = await prisma.otpCode.findFirst({ where: { phone: o.phone, purpose: o.purpose }, orderBy: { createdAt: "desc" } });
  if (last && Date.now() - last.createdAt.getTime() < COOLDOWN_MS)
    throw new OtpError(429, "otp_wait", Math.ceil((COOLDOWN_MS - (Date.now() - last.createdAt.getTime())) / 1000));
  if ((await prisma.otpCode.count({ where: { phone: o.phone, createdAt: { gt: new Date(Date.now() - 3600_000) } } })) >= MAX_PER_HOUR)
    throw new OtpError(429, "otp_limit", 3600);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  // New code invalidates older unused ones.
  await prisma.otpCode.updateMany({ where: { phone: o.phone, purpose: o.purpose, usedAt: null }, data: { usedAt: new Date() } });
  const row = await prisma.otpCode.create({ data: { phone: o.phone, purpose: o.purpose, userId: o.userId, codeHash: hashCode(o.phone, o.purpose, code), expiresAt: new Date(Date.now() + TTL_MS) } });
  const channel: Channel | null = await sendPlatformMessage(o.phone, (TEXT[o.language ?? "en"] ?? TEXT.en!).replace("{code}", code));
  if (channel) await prisma.otpCode.update({ where: { id: row.id }, data: { channel } });
  else if (!devEcho()) throw new OtpError(503, "otp_undeliverable"); // production with no working channel: say so, never reveal the code
  else console.log(`[verification code - no WhatsApp/SMS channel configured] ${o.phone}: ${code}`);
  return { channel: channel ?? "dev", expiresInSec: TTL_MS / 1000, ...(channel ? {} : { devCode: code }) };
}

// True when the code matches. Wrong guesses are counted; after 5 the code is dead.
export async function checkOtp(phone: string, purpose: OtpPurpose, code: string): Promise<boolean> {
  const row = await prisma.otpCode.findFirst({ where: { phone, purpose, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!row || row.attempts >= MAX_ATTEMPTS) return false;
  const a = Buffer.from(row.codeHash), b = Buffer.from(hashCode(phone, purpose, code));
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    const used = await prisma.otpCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    return used.count === 1;
  }
  await prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
  return false;
}
