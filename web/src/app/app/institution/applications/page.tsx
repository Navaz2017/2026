"use client";
import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { useLiveReload } from "@/lib/realtime";
import { Badge, Card, Empty, Field, Loading, Page, dt, useLoad } from "@/lib/ui";

export default function Applications() {
  const { t } = useT();
  const [status, setStatus] = useState(""), [q, setQ] = useState("");
  const { data, error, loading, reload } = useLoad<any[]>(`/institution/applications?q=${encodeURIComponent(q)}${status ? `&status=${status}` : ""}`);
  useLiveReload(reload);
  return (
    <Page title={t("nav.applications")}>
      <div className="tabs">{["", "SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED"].map((s) => <button key={s} className={`tab ${s === status ? "on" : ""}`} onClick={() => setStatus(s)}>{s ? t(`st.app.${s}`) : t("common.all")}</button>)}</div>
      <Field label={t("inst.search")}><input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      <Loading error={error} loading={loading} />
      {data?.length === 0 && <Empty />}
      {data?.map((a) => (
        <Card key={a.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div><strong>{a.student.fullName}</strong><div className="muted">{a.program.title} · {t("inst.received")} {dt(a.updatedAt)}</div></div>
            <div className="row"><Badge ns="st.app" value={a.status} />{a.decidedAt && !a.decisionPublishedAt && <span className="badge neutral">{t("lh.onHold")}</span>}<Link className="btn primary" href={`/app/institution/applications/${a.id}`}>{t("inst.open")}</Link></div>
          </div>
        </Card>
      ))}
    </Page>
  );
}
