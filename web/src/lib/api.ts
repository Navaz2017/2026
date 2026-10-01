// Tokens live in memory (access) + sessionStorage-free; refresh token should be moved to an httpOnly
// cookie via a Next route handler (BFF) before production so XSS can never read it.
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
let access: string | null = null;
export type Role = "SYSTEM_OWNER" | "INSTITUTION_ADMIN" | "PARENT" | "STUDENT";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API}/v1${path}`, { ...init, headers: { "Content-Type": "application/json", ...(access && { Authorization: `Bearer ${access}` }), ...init.headers } });
  if (!r.ok) throw Object.assign(new Error(r.statusText), { status: r.status, body: await r.json().catch(() => null) });
  return r.status === 204 ? (undefined as T) : r.json();
}

export async function login(email: string, password: string) {
  const r = await api<{ accessToken: string; role: Role }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  access = r.accessToken;
  return r.role;
}
