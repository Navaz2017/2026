"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { SiteHeader } from "@/components/SiteHeader";
import { LanguageSwitcher, useT } from "@/lib/i18n";
import { api } from "@/lib/api";
import { homeFor, useSession } from "@/lib/session";
import { mk } from "@/lib/ui";

export default function Landing() {
  const { t } = useT();
  const { user } = useSession();
  const [q, setQ] = useState(""), [term, setTerm] = useState("");
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api<any[]>(`/public/programs?q=${encodeURIComponent(term)}`).then((r) => setRows(r.slice(0, 6))).catch(() => setRows([])); }, [term]);

  return (
    <>
      <SiteHeader>
        {user
          ? <Link className="out" href={homeFor(user.role)} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>{t("nav.dashboard")}</Link>
          : <><Link className="out" href="/login" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>{t("auth.signIn")}</Link></>}
      </SiteHeader>
      <main id="main">
        <section className="hero"><div className="in">
          <div className="rule" />
          <h1>{t("landing.heroTitle")}</h1>
          <p className="sub">{t("landing.heroSub")}</p>
          <form className="herosearch" role="search" onSubmit={(e) => { e.preventDefault(); setTerm(q); document.getElementById("open")?.scrollIntoView({ behavior: "smooth" }); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("landing.searchPlaceholder")} aria-label={t("landing.searchPlaceholder")} />
            <button className="btn"><Icon name="search" size={20} />{t("common.search")}</button>
          </form>
          {!user && <div className="herocta"><Link className="btn" href="/signup">{t("auth.signUp")}</Link></div>}
        </div></section>

        <section className="section" id="open">
          <h2>{t("landing.featured")}</h2>
          {rows && rows.length === 0 && <p className="muted">{t("common.none")}</p>}
          <div className="grid two">
            {rows?.map((p) => (
              <article key={p.id} className="card" style={{ marginBottom: 0 }}>
                <span className="badge neutral">{t(`type.${p.institution.type}`)}</span>
                <h3 style={{ marginTop: ".6rem" }}>{p.title}</h3>
                <div>{p.institution.name}{p.institution.district ? ` · ${p.institution.district}` : ""}</div>
                <div className="muted" style={{ margin: ".4rem 0 .9rem" }}>{t("fam.totalFee")}: <strong>{mk(p.totalDueMinor)}</strong> · {t("fam.seatsLeft", { n: Math.max(0, p.seats - p.seatsTaken) })}</div>
                <Link className="btn" href={user ? "/app/browse" : "/login"}>{t("fam.apply")}<Icon name="arrow" size={18} /></Link>
              </article>
            ))}
          </div>
        </section>

        <section className="section" style={{ paddingTop: 0 }}>
          <div className="pillars">
            {[["family", "p1"], ["cap", "p2"], ["verified", "p3"]].map(([icon, k]) => (
              <div key={k} className="pillar"><Icon name={icon!} size={30} /><h3>{t(`landing.${k}Title`)}</h3><p className="muted" style={{ margin: 0 }}>{t(`landing.${k}Text`)}</p></div>
            ))}
          </div>
        </section>

        <section className="section" style={{ paddingTop: 0 }}>
          <h2>{t("landing.howTitle")}</h2>
          <ol className="steps" style={{ padding: 0, margin: 0 }}>{[1, 2, 3, 4].map((n) => <li key={n}>{t(`landing.step${n}`)}</li>)}</ol>
        </section>
      </main>
      <footer className="footer"><div className="in"><span>© {new Date().getFullYear()} {t("common.appName")}. {t("landing.rights")}</span><LanguageSwitcher /></div></footer>
    </>
  );
}
