import type { Provider } from "@prisma/client";
import { normalisePhone } from "./phone.js";

export interface ParsedSms {
  provider: Provider;
  reference: string;
  payerPhone: string;
  amountMinor: number;
}

// IMPORTANT: wording differs between operators and changes over time. These patterns are a starting
// point — collect ~50 real messages from each operator and extend test/smsParser.test.ts BEFORE go-live.
// Unparseable messages are stored (parsedOk=false) and shown in the owner's "unmatched SMS" queue.
const RULES: { provider: Provider; senders: RegExp; patterns: RegExp[] }[] = [
  {
    provider: "AIRTEL_MONEY",
    senders: /^airtel\s*money$/i,
    patterns: [
      /received\s+MK\s?([\d,]+(?:\.\d+)?)\s+from\s+(\+?\d[\d\s]{8,13}).*?(?:Trans(?:action)?\s*ID|TID|Ref(?:erence)?)[:\s]+([A-Z0-9]{6,20})/is,
    ],
  },
  {
    provider: "MPAMBA",
    senders: /^(tnm\s*mpamba|mpamba)$/i,
    patterns: [
      /(?:Confirmed|Conf)\.?\s*([A-Z0-9]{6,20}).*?received\s+MWK?\s?([\d,]+(?:\.\d+)?)\s+from\s+(\+?\d[\d\s]{8,13})/is,
    ],
  },
];

export function parseSms(sender: string, body: string): ParsedSms | null {
  for (const rule of RULES) {
    if (!rule.senders.test(sender.trim())) continue;
    for (const p of rule.patterns) {
      const m = body.match(p);
      if (!m) continue;
      // Airtel: amount, phone, ref. Mpamba: ref, amount, phone.
      const [amountRaw, phoneRaw, ref] = rule.provider === "AIRTEL_MONEY" ? [m[1], m[2], m[3]] : [m[2], m[3], m[1]];
      const phone = normalisePhone(phoneRaw ?? "");
      const amount = Number((amountRaw ?? "").replace(/,/g, ""));
      if (!phone || !ref || !Number.isFinite(amount)) return null;
      return { provider: rule.provider, reference: ref.toUpperCase(), payerPhone: phone, amountMinor: Math.round(amount * 100) };
    }
  }
  return null;
}
