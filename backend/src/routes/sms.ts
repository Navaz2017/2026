import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { decrypt, deviceSignature, timingSafeEqualHex } from "../lib/crypto.js";
import { parseSms } from "../lib/smsParser.js";
import { reconcile } from "../lib/reconcile.js";
import { h } from "../middleware/validate.js";

export const sms = Router();

const payload = z.object({
  messages: z.array(z.object({ sender: z.string().max(40), body: z.string().max(1000), receivedAt: z.coerce.date() })).min(1).max(100),
});

// Authenticated by device HMAC (not a user JWT): X-Device-Id, X-Timestamp, X-Nonce, X-Signature.
// Timestamp window + one-time nonce stop replay; the raw body is signed so it cannot be altered.
sms.post("/ingest", h(async (req, res) => {
  const id = String(req.header("x-device-id") ?? "");
  const ts = String(req.header("x-timestamp") ?? "");
  const nonce = String(req.header("x-nonce") ?? "");
  const sig = String(req.header("x-signature") ?? "");
  const raw: string = (req as any).rawBody ?? "";
  const device = id ? await prisma.device.findFirst({ where: { id, revokedAt: null } }).catch(() => null) : null;
  if (!device || !/^\d{10,13}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > 5 * 60_000 || nonce.length < 16)
    return res.status(401).json({ error: "unauthorised" });
  if (!/^[0-9a-f]{64}$/.test(sig) || !timingSafeEqualHex(sig, deviceSignature(decrypt(device.keyEnc), ts, nonce, raw)))
    return res.status(401).json({ error: "unauthorised" });
  try {
    await prisma.deviceNonce.create({ data: { deviceId: device.id, nonce } });
  } catch { return res.status(409).json({ error: "replay" }); }

  const parsedBody = payload.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: "validation" });
  let stored = 0;
  for (const m of parsedBody.data.messages) {
    const p = parseSms(m.sender, m.body);
    try {
      await prisma.smsMessage.create({ data: {
        deviceId: device.id, sender: m.sender, rawBody: m.body, receivedAt: m.receivedAt,
        parsedOk: !!p, provider: p?.provider ?? (/airtel/i.test(m.sender) ? "AIRTEL_MONEY" : "MPAMBA"),
        reference: p?.reference, payerPhone: p?.payerPhone, amountMinor: p?.amountMinor,
      } });
      stored++;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // duplicate delivery / reused reference
      throw e;
    }
    if (p) await reconcile(p.provider, p.reference);
  }
  await prisma.device.update({ where: { id: device.id }, data: { lastSeen: new Date() } });
  res.json({ stored });
}));
