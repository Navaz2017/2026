import type { Provider } from "@prisma/client";
import { normalisePhone } from "./phone.js";
import { normaliseReference } from "./reference.js";

export interface ParsedSms {
  provider: Provider;
  reference: string; // primary transaction id
  altReference?: string; // secondary id (Airtel bank deposits)
  payerPhone?: string; // only Mpamba reveals it
  payerName?: string;
  amountMinor: number;
}

const AMT = String.raw`([\d,]+(?:\.\d+)?)`;
const TID = String.raw`([A-Z0-9]+(?:\.[A-Z0-9]+)+)`;

// Parsing is content-based (sender IDs vary by handset/carrier). Only INCOMING-money messages match;
// "... sent: ..." / "Money Sent to ..." messages deliberately return null.
// Based on real samples supplied by the owner (Sept 2026). Add new wordings here + in test/core.test.ts.
export function parseSms(_sender: string, rawBody: string): ParsedSms | null {
  const body = rawBody.replace(/\s+/g, " ").trim();
  let m: RegExpMatchArray | null;

  // Airtel bank/other credit: "BW260929.1403.PL4887. You have received MK 10,000 from FCB BANK on 29/09/26 02:03 PM. Ref 000391467945 Bal: ..."
  if ((m = body.match(new RegExp(String.raw`^${TID}\.?\s+You have received MK\s?${AMT} from (.+?) on \d{2}/\d{2}/\d{2,4}.*?(?:\bRef\s+([A-Z0-9]+))?\s*Bal`, "i")))) {
    return build("AIRTEL_MONEY", m[1]!, m[2]!, { name: m[3], alt: m[4] });
  }
  // Airtel wallet deposit: "SHIDAHCHITAYA has deposited MK 9,000 to your account on 15/09/26 06:03 PM.Bal: MK 9373.52. TID CI260915.1803.125840."
  if ((m = body.match(new RegExp(String.raw`^(.+?) has deposited MK\s?${AMT} to your account on .*?\bTID\s+${TID}`, "i")))) {
    return build("AIRTEL_MONEY", m[3]!, m[2]!, { name: m[1] });
  }
  // Mpamba: "Money Received from 265883095004 JAMES BLIGHT on 23/04/2026 12:50:52. Amount: 2,500.00MWK Ref: DHN1368TJHT Bal: ..."
  if ((m = body.match(new RegExp(String.raw`^Money Received from\s+(\+?\d{9,13})\s+(.+?)\s+on \d{2}/\d{2}/\d{2,4}.*?Amount:\s*${AMT}\s*MWK.*?Ref:\s*([A-Z0-9]+)`, "i")))) {
    const phone = normalisePhone(m[1]!);
    return phone ? build("MPAMBA", m[4]!, m[3]!, { name: m[2], phone }) : null;
  }
  return null;
}

function build(provider: Provider, ref: string, amount: string, x: { name?: string; alt?: string; phone?: string }): ParsedSms | null {
  const n = Number(amount.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return {
    provider, reference: normaliseReference(ref), amountMinor: Math.round(n * 100),
    ...(x.alt && { altReference: normaliseReference(x.alt) }), ...(x.phone && { payerPhone: x.phone }), ...(x.name && { payerName: x.name.trim() }),
  };
}
