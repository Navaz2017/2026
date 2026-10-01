"use client";
import { useState } from "react";
import { downloadBlob, post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Badge, Btn, Card, Empty, Field, Loading, Msg, Page, dt, mk, useBusy, useLoad } from "@/lib/ui";

export default function Settlements() {
  const { t } = useT();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data, error, loading, reload } = useLoad<any[]>("/admin/settlements");
  const { busy, msg, run } = useBusy();
  const rows = data?.filter((s) => s.periodStart.slice(0, 7) === month) ?? [];
  const total = rows.reduce((n, s) => n + s.netPayableMinor, 0);

  return (
    <Page title={t("set.title")} actions={<Btn kind="ghost" onClick={() => run(() => downloadBlob(`/admin/settlements/export.csv?month=${month}`, `payouts-${month}.csv`))}>{t("set.export")}</Btn>}>
      <Card>
        <div className="row">
          <Field label={t("common.month")}><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
          <Btn busy={busy} onClick={() => run(async () => { await post("/admin/settlements/run", { month }); await reload(); })}>{t("set.run")}</Btn>
        </div>
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      </Card>
      <Loading error={error} loading={loading} />
      {data && rows.length === 0 && <p className="muted">{t("set.nothing")}</p>}
      {rows.length > 0 && <p><strong>{t("common.total")}: {mk(total)}</strong></p>}
      {rows.map((s) => (
        <Card key={s.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <strong>{s.institution.name}</strong>
              <div>{t("set.payTo")}: {s.institution.payoutProvider ? t(`provider.${s.institution.payoutProvider}`) : "—"} {s.institution.payoutPhone ?? ""}</div>
              <div className="muted">{t("set.gross")}: {mk(s.grossFeesMinor)} · {t("set.commission")}: {mk(s.commissionMinor)}</div>
              <div><strong>{t("set.net")}: {mk(s.netPayableMinor)}</strong> {s.payoutRef && <span className="muted">· {s.payoutRef}</span>}</div>
            </div>
            <div className="row">
              <span className={`badge ${s.status === "PAID" ? "good" : "wait"}`}>{s.status === "PAID" ? "✓" : "…"} {s.status}</span>
              {s.status !== "PAID" && <Btn busy={busy} onClick={() => { const ref = window.prompt(t("set.payoutRef")); if (ref) run(async () => { await post(`/admin/settlements/${s.id}/mark-paid`, { payoutRef: ref }); await reload(); }); }}>{t("set.markPaid")}</Btn>}
            </div>
          </div>
        </Card>
      ))}
    </Page>
  );
}
