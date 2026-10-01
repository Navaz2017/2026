"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV } from "@/lib/nav";
import { useSession, homeFor } from "@/lib/session";
import { LanguageSwitcher, useT } from "@/lib/i18n";
import { api } from "@/lib/api";
import { Msg } from "@/lib/ui";

const ROLE_PREFIX: Record<string, string> = { SYSTEM_OWNER: "/app/owner", INSTITUTION_ADMIN: "/app/institution" };

export default function Shell({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut, changeLanguage } = useSession();
  const { t } = useT();
  const path = usePathname(), router = useRouter();
  const [unread, setUnread] = useState(0);

  useEffect(() => { if (!loading && !user) router.replace("/"); }, [loading, user, router]);
  // A parent opening an owner URL (etc.) is sent home; the API would refuse the data anyway.
  useEffect(() => {
    if (!user) return;
    const other = Object.entries(ROLE_PREFIX).find(([role, p]) => role !== user.role && path.startsWith(p));
    if (other) router.replace(homeFor(user.role));
  }, [user, path, router]);

  useEffect(() => { // gentle polling, only while the tab is visible, jittered so many users never sync at once
    if (!user) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") { try { setUnread((await api<any[]>("/auth/notifications")).filter((n) => !n.readAt).length); } catch {} }
      timer = setTimeout(tick, 60_000 + Math.random() * 30_000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [user]);

  if (loading || !user) return <p className="muted" style={{ padding: 24 }}>{t("common.loading")}</p>;
  // Highlight only the most specific matching entry (so "Overview" is not lit while "Applications" is open).
  const active = NAV[user.role].filter((n) => path === n.href || path.startsWith(n.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const needsMfa = (user.role === "SYSTEM_OWNER" || user.role === "INSTITUTION_ADMIN") && !user.mfa;

  return (
    <div className="shell">
      <nav className="side" aria-label={t("nav.menu")}>
        <div className="logo" style={{ padding: ".5rem .75rem" }}>{t("common.appName")}</div>
        {NAV[user.role].map((n) => (
          <Link key={n.href} href={n.href} className={`nav ${n.href === active ? "on" : ""}`} aria-current={n.href === active ? "page" : undefined}>
            <span aria-hidden>{n.icon}</span><span>{t(n.key)}</span>
          </Link>
        ))}
      </nav>
      <div className="main">
        <div className="topbar">
          <LanguageSwitcher onChange={changeLanguage} />
          <Link href="/app/notifications" className="bell btn ghost" aria-label={t("nav.notifications")}>🔔{unread > 0 && <span className="n">{unread}</span>}</Link>
          <span className="muted">{user.fullName}</span>
          <button className="btn" onClick={signOut}>{t("auth.signOut")}</button>
        </div>
        {needsMfa && path !== "/app/security" && (
          <Msg kind="warn">{t("mfa.required")} <Link href="/app/security">{t("mfa.goSetup")}</Link></Msg>
        )}
        {children}
      </div>
    </div>
  );
}
