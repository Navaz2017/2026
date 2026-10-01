"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { Card, Field, Loading, Page, dtt, useLoad } from "@/lib/ui";

export default function Audit() {
  const { t } = useT();
  const [f, setF] = useState("");
  const { data, error, loading } = useLoad<any[]>(`/admin/audit?action=${encodeURIComponent(f)}`);
  return (
    <Page title={t("aud.title")}>
      <Field label={t("aud.filter")}><input value={f} onChange={(e) => setF(e.target.value)} /></Field>
      <Loading error={error} loading={loading} />
      <Card><div className="tblwrap"><table className="tbl"><thead><tr><th>{t("common.date")}</th><th>{t("aud.action")}</th><th>{t("aud.who")}</th><th>IP</th><th /></tr></thead>
        <tbody>{data?.map((a) => <tr key={a.id}><td>{dtt(a.createdAt)}</td><td className="mono">{a.action}</td><td className="mono">{a.actorId?.slice(0, 8)}</td><td>{a.ip}</td><td className="muted">{a.meta ? JSON.stringify(a.meta).slice(0, 80) : ""}</td></tr>)}</tbody></table></div></Card>
    </Page>
  );
}
