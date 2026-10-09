import { NextRequest, NextResponse } from "next/server";

// Nonce-based CSP: only scripts Next itself emits (carrying this request's nonce) may run, so an injected
// <script> or inline handler is blocked even if an XSS bug slips through.
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // React inline style attributes
    `img-src 'self' data: blob: https: ${api}`,
    `media-src 'self' https: ${api}`,
    `connect-src 'self' ${api} ${api.replace(/^http/, "ws")} https: wss:`, // ws(s): live updates from our own API; https: for direct uploads
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join("; ");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = { matcher: [{ source: "/((?!api|_next/static|_next/image|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }] };
