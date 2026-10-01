"use client";
import { useState } from "react";
import { login } from "@/lib/api";

export default function Login() {
  const [err, setErr] = useState("");
  return (
    <form style={{ maxWidth: 360, margin: "10vh auto", display: "grid", gap: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          const role = await login(String(f.get("email")), String(f.get("password")));
          window.location.href = { SYSTEM_OWNER: "/app/owner", INSTITUTION_ADMIN: "/app/institution", PARENT: "/app/family", STUDENT: "/app/family" }[role];
        } catch { setErr("Invalid email or password"); }
      }}>
      <h1>Sign in</h1>
      <input name="email" type="email" placeholder="Email" required autoComplete="username" />
      <input name="password" type="password" placeholder="Password" required autoComplete="current-password" />
      <button>Sign in</button>
      {err && <p role="alert">{err}</p>}
    </form>
  );
}
