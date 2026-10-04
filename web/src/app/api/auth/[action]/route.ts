import { NextRequest, NextResponse } from "next/server";

// Backend-for-frontend for the endpoints that mint refresh tokens. The refresh token is put in an
// httpOnly, SameSite=Strict cookie scoped to /api/auth and is NEVER returned to page JavaScript.
const API = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const PATHS: Record<string, string> = { login: "/auth/login", signup: "/auth/signup", refresh: "/auth/refresh", "mfa-enable": "/auth/mfa/enable", logout: "/auth/logout" };
const COOKIE = "rt";
const clientIp = (req: NextRequest) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const path = PATHS[action];
  if (!path) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: "forbidden" }, { status: 403 }); // CSRF belt-and-braces

  const fromCookie = action === "refresh" || action === "logout";
  const body = fromCookie ? { refreshToken: req.cookies.get(COOKIE)?.value ?? "" } : await req.json().catch(() => ({}));
  const upstream = await fetch(`${API}/v1${path}`, {
    method: "POST", cache: "no-store",
    // Forward the real client IP so the API's brute-force limits apply per person, not per web server.
    headers: { "Content-Type": "application/json", ...(clientIp(req) && { "X-Forwarded-For": clientIp(req)! }), ...(req.headers.get("authorization") && { Authorization: req.headers.get("authorization")! }) },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ error: "network" }, { status: 502 });

  const data = upstream.status === 204 ? {} : await upstream.json().catch(() => ({}));
  const { refreshToken, ...safe } = data as Record<string, unknown>;
  const res = NextResponse.json(safe, { status: upstream.status === 204 ? 200 : upstream.status });
  if (typeof refreshToken === "string") {
    res.cookies.set(COOKIE, refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api/auth", maxAge: 30 * 86400 });
  }
  if (action === "logout" || (action === "refresh" && !upstream.ok)) res.cookies.delete({ name: COOKIE, path: "/api/auth" });
  return res;
}
