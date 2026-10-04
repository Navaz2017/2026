"use client";
import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { Empty, Field, Loading, Page, mk, dt, useLoad } from "@/lib/ui";
import { Card, Btn } from "@/lib/ui";
import { ProgramFacts } from "@/components/SchoolView";

// Find a programme or class; each card links to the school's page (fees, photos, videos) and starts the application.
export default function Browse() {
  const { t } = useT();
  const [q, setQ] = useState(""), [type, setType] = useState("");
  const progs = useLoad<any[]>(`/public/programs?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ""}`);
  return (
    <Page title={t("nav.browse")}>
      <div className="grid two">
        <Field label={t("fam.search")}><input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Field label={t("auth.instType")}><select value={type} onChange={(e) => setType(e.target.value)}><option value="">{t("fam.allTypes")}</option>{["PRIMARY_SCHOOL", "SECONDARY_SCHOOL", "COLLEGE", "UNIVERSITY"].map((k) => <option key={k} value={k}>{t(`type.${k}`)}</option>)}</select></Field>
      </div>
      <Loading error={progs.error} loading={progs.loading} />
      {progs.data?.length === 0 && <Empty />}
      {progs.data?.map((p) => {
        const left = p.seats - p.seatsTaken;
        return (
          <Card key={p.id}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <span className="badge neutral">{t(`type.${p.institution.type}`)}</span>
                <h3 style={{ marginTop: ".4rem" }}>{p.title}{p.code ? <span className="muted"> · {p.code}</span> : null}</h3>
                <div><Link href={`/schools/${p.institution.id}`}>{p.institution.name}</Link> <span className="muted">{p.institution.district ? `· ${p.institution.district}` : ""}</span></div>
                <ProgramFacts p={p} />
                <div className="muted">{t("fam.totalFee")}: <strong>{mk(p.totalDueMinor)}</strong> · {left > 0 ? t("fam.seatsLeft", { n: left }) : t("fam.full")}{p.closesAt && ` · ${t("fam.closesOn", { date: dt(p.closesAt) })}`}</div>
              </div>
              <div className="row">
                <Link className="btn" href={`/schools/${p.institution.id}`}>{t("fam.viewSchool")}</Link>
                {left > 0 ? <Link className="btn primary" href={`/app/apply?program=${p.id}`}>{t("fam.apply")}</Link> : <Btn disabled>{t("fam.full")}</Btn>}
              </div>
            </div>
          </Card>
        );
      })}
    </Page>
  );
}
