import test from "node:test";
import assert from "node:assert/strict";
import { splitFee } from "../src/lib/money.js";
import { parseSms } from "../src/lib/smsParser.js";
import { normalisePhone } from "../src/lib/phone.js";
import { renderLetter } from "../src/lib/letters.js";
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

test("sms parser (sample wording — replace with real operator messages)", () => {
  const a = parseSms("AIRTEL MONEY", "You have received MK13,000.00 from 0991234567. Trans ID: MP240101ABCD. Balance MK5,000");
  assert.deepEqual(a, { provider: "AIRTEL_MONEY", reference: "MP240101ABCD", payerPhone: "+265991234567", amountMinor: 1_300_000 });
  assert.equal(parseSms("Unknown", "hello"), null);
});

test("letter templates escape HTML and ignore code", () => {
  const out = renderLetter("Hi {{name}} {{ evil }}", { name: "<script>x</script>" });
  assert.equal(out, "Hi &lt;script&gt;x&lt;/script&gt; ");
});

test("device signature is stable and body-bound", () => {
  const a = deviceSignature("k", "1", "n", "{}");
  assert.equal(a, deviceSignature("k", "1", "n", "{}"));
  assert.notEqual(a, deviceSignature("k", "1", "n", "{ }"));
});
