// Pretend to be the phone: sends one signed SMS to a running server. Useful before the APK is installed.
//   API_URL=http://localhost:4000 DEVICE_ID=... DEVICE_KEY=... npx tsx scripts/sms-simulator.ts "SHIDAH has deposited MK 13,000 to your account on 15/09/26 06:03 PM.Bal: MK 1. TID CI260915.1803.125840."
import crypto from "node:crypto";
import { deviceSignature } from "../src/lib/crypto.js";

const { API_URL = "http://localhost:4000", DEVICE_ID, DEVICE_KEY } = process.env;
const text = process.argv[2];
if (!DEVICE_ID || !DEVICE_KEY || !text) { console.error("need DEVICE_ID, DEVICE_KEY and the SMS text as argument"); process.exit(1); }
const raw = JSON.stringify({ messages: [{ sender: "AirtelMoney", body: text, receivedAt: new Date().toISOString() }] });
const ts = String(Date.now()), nonce = crypto.randomBytes(16).toString("hex");
const r = await fetch(`${API_URL}/v1/sms/ingest`, { method: "POST", body: raw, headers: {
  "Content-Type": "application/json", "x-device-id": DEVICE_ID, "x-timestamp": ts, "x-nonce": nonce, "x-signature": deviceSignature(DEVICE_KEY, ts, nonce, raw) } });
console.log(r.status, await r.text());
