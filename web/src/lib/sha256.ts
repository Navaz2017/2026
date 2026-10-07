import { sha256 as jsSha256 } from "js-sha256";

// Browsers only expose crypto.subtle on HTTPS (or localhost). A server reached over plain http on a local network
// has no crypto.subtle, so fall back to a small pure-JS implementation. Both give identical results.
export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf))).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return jsSha256(buf);
}
