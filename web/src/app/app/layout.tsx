"use client";
import Link from "next/link";
import { NAV } from "@/lib/nav";
import type { Role } from "@/lib/api";

// TODO: derive role from the session (BFF cookie) instead of a placeholder.
export default function Shell({ children }: { children: React.ReactNode }) {
  const role: Role = "SYSTEM_OWNER";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", minHeight: "100vh" }}>
      <nav style={{ padding: 16, borderRight: "1px solid #ddd", display: "grid", alignContent: "start", gap: 8 }}>
        {NAV[role].map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}
      </nav>
      <main style={{ padding: 24 }}>{children}</main>
    </div>
  );
}
