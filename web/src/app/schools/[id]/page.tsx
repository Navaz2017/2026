"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SchoolView } from "@/components/SchoolView";
import { SiteHeader } from "@/components/SiteHeader";
import { LanguageSwitcher, useT } from "@/lib/i18n";
import { homeFor, useSession } from "@/lib/session";
import { Loading, useLoad } from "@/lib/ui";

// Public page (no sign-in): what a school offers, its fees and its photos/videos.
export default function School() {
  const { id } = useParams<{ id: string }>();
  const { t } = useT();
  const { user } = useSession();
  const { data, error, loading } = useLoad<any>(`/public/institutions/${id}`);
  return (
    <>
      <SiteHeader>{user ? <Link className="out" href={homeFor(user.role)} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>{t("nav.dashboard")}</Link> : <Link className="out" href="/login" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>{t("auth.signIn")}</Link>}</SiteHeader>
      <main id="main" className="section">
        <Loading error={error} loading={loading} />
        {data && <SchoolView s={data} applyHref={(pid) => (user ? `/app/apply?program=${pid}` : "/login")} />}
      </main>
      <footer className="footer"><div className="in"><span>© {new Date().getFullYear()} {t("common.appName")}</span><LanguageSwitcher /></div></footer>
    </>
  );
}
