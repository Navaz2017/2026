import test from "node:test";
import assert from "node:assert/strict";
import { splitFee } from "../src/lib/money.js";
import { parseSms } from "../src/lib/smsParser.js";
import { normalisePhone } from "../src/lib/phone.js";
import { normaliseReference, REFERENCE_RE } from "../src/lib/reference.js";
import { renderLetter, renderLetterHtml } from "../src/lib/letters.js";
import { deviceSignature } from "../src/lib/crypto.js";

test("30% commission + 30% student service fee", () => {
  const s = splitFee(1_000_000, 3000, 3000); // MK10,000.00 in tambala
  assert.equal(s.totalDueMinor, 1_300_000);
  assert.equal(s.institutionNetMinor, 700_000);
  assert.equal(s.ownerRevenueMinor, 600_000);
  assert.equal(s.institutionNetMinor + s.ownerRevenueMinor, s.totalDueMinor); // every tambala accounted for
});

test("rounding never loses money", () => {
  for (const fee of [1, 33, 999, 12_345]) {
    const s = splitFee(fee, 3000, 3000);
    assert.equal(s.institutionNetMinor + s.ownerRevenueMinor, s.totalDueMinor);
  }
});

test("phones normalise", () => {
  assert.equal(normalisePhone("0999 123 456"), "+265999123456");
  assert.equal(normalisePhone("+265881234567"), "+265881234567");
  assert.equal(normalisePhone("12345"), null);
});

const sms = (b: string) => parseSms("x", b);

test("Airtel: bank credit carries TID + bank Ref, no phone", () => {
  assert.deepEqual(sms("BW260929.1403.PL4887. You have received MK 10,000 from FCB BANK on 29/09/26 02:03 PM. Ref 000391467945 Bal: MK 10373.52."),
    { provider: "AIRTEL_MONEY", reference: "BW260929.1403.PL4887", altReference: "000391467945", payerName: "FCB BANK", amountMinor: 1_000_000 });
  assert.deepEqual(sms("BW260915.1030.G99287. You have received MK 15,000 from NATIONAL BANK on 15/09/26 10:30 AM. Ref FT26258JK78P Bal: MK 15028.52."),
    { provider: "AIRTEL_MONEY", reference: "BW260915.1030.G99287", altReference: "FT26258JK78P", payerName: "NATIONAL BANK", amountMinor: 1_500_000 });
});

test("Airtel: wallet deposit", () => {
  assert.deepEqual(sms("SHIDAHCHITAYA has deposited MK 9,000 to your account on 15/09/26 06:03 PM.Bal: MK 9373.52. TID CI260915.1803.125840."),
    { provider: "AIRTEL_MONEY", reference: "CI260915.1803.125840", payerName: "SHIDAHCHITAYA", amountMinor: 900_000 });
  assert.equal(sms("BRIDGETMALUNGA has deposited MK 5,000 to your account on 14/09/26 02:42 PM.Bal: MK 10988.52. TID CI260914.1442.125098.")?.reference, "CI260914.1442.125098");
});

test("Mpamba: money received includes payer phone", () => {
  assert.deepEqual(sms("Money Received from 265883095004 JAMES BLIGHT on 23/04/2026 12:50:52. \nAmount: 2,500.00MWK \nRef: DHN1368TJHT \nBal: 2,509.28MWK"),
    { provider: "MPAMBA", reference: "DHN1368TJHT", payerPhone: "+265883095004", payerName: "JAMES BLIGHT", amountMinor: 250_000 });
});

test("outgoing-money messages are never treated as payments", () => {
  assert.equal(sms("MWK4,500 sent: 10226768 MERVIS SANUDI on 29/09/26 04:31 PM. Fee: MWK200, Levy: MK0.0. Bal: MWK673.52 TID:CO260929.1631.OB7196."), null);
  assert.equal(sms("MWK16,000 sent: 10057471 BRIDGET MALUNGA on 20/09/26 01:32 PM. Fee: MWK800, Levy: MK0.0. Bal: MWK723.52 TID:CO260920.1332.G97907."), null);
  assert.equal(sms("Money Sent to 0891852731 MERCY CHIRWA on 13/08/2026 19:25:28. \nAmount: 5,400.00MWK \nFee: 75.00MWK \nRef: DHD135BKBTH \nBal: 6,548.16MWK"), null);
  assert.equal(sms("Hi, are we meeting today?"), null);
});

test("references normalise the way applicants type them", () => {
  assert.equal(normaliseReference(" ci260915.1803.125840. "), "CI260915.1803.125840");
  assert.ok(REFERENCE_RE.test("CI260915.1803.125840") && !REFERENCE_RE.test("a b") && !REFERENCE_RE.test("x;drop"));
});

test("letter templates escape HTML and ignore code", () => {
  assert.equal(renderLetterHtml("Hi {{name}} {{ evil }}", { name: "<script>x</script>" }), "Hi &lt;script&gt;x&lt;/script&gt; ");
  assert.equal(renderLetter("Fish & {{name}}", { name: "Chips" }), "Fish & Chips"); // plain text for PDF / WhatsApp
});

test("device signature is stable and body-bound", () => {
  const a = deviceSignature("k", "1", "n", "{}");
  assert.equal(a, deviceSignature("k", "1", "n", "{}"));
  assert.notEqual(a, deviceSignature("k", "1", "n", "{ }"));
});
