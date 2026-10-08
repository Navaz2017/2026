import { config } from "../config.js";

// Africa's Talking bulk SMS. Plain fetch: no SDK, no extra dependency.
export const smsConfigured = () => !!(config.AT_API_KEY && config.AT_USERNAME);

const baseUrl = () => config.AT_BASE_URL ?? (config.AT_ENV === "production" ? "https://api.africastalking.com" : "https://api.sandbox.africastalking.com");

export async function sendSms(to: string, message: string): Promise<void> {
  if (!smsConfigured()) throw new Error("sms_not_configured");
  const form = new URLSearchParams({ username: config.AT_USERNAME!, to, message });
  if (config.AT_SENDER_ID) form.set("from", config.AT_SENDER_ID);
  const r = await fetch(`${baseUrl()}/version1/messaging`, {
    method: "POST", signal: AbortSignal.timeout(10_000),
    headers: { apiKey: config.AT_API_KEY!, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!r.ok) throw new Error(`sms_http_${r.status}`);
  const j = (await r.json().catch(() => null)) as { SMSMessageData?: { Recipients?: { statusCode: number; status: string }[] } } | null;
  const rec = j?.SMSMessageData?.Recipients?.[0];
  if (!rec || rec.statusCode < 100 || rec.statusCode > 102) throw new Error(`sms_rejected_${rec?.status ?? "unknown"}`); // 100-102 = processed/sent/queued
}
