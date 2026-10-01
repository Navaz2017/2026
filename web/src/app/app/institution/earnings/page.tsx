"use client";
import { useEffect, useState } from "react";
import { patch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Btn, Card, Empty, Field, Loading, Msg, Page, dt, mk, useBusy, useLoad } from "@/lib/ui";

export default function Earnings() {
  const { t } = useT();
  const d = useLoad<any>("/institution/dashboard");
  const me = useLoad<any>("/institution/me");
  const s = useLoad<any[]>("/institution/settlements");
  const [prov, setProv] = useState(""), [phone, setPhone] = useState("");
  const { busy, msg, run } = useBusy();
  useEffect(() => { if (me.data) { setProv(me.data.payoutProvider ?? ""); setPhone(me.data.payoutPhone ?? ""); } }, [me.data]);
  return (
    <Page title={t("nav.earnings")}>
      <Loading error={d.error} loading={d.loading} />
      {d.data && <Card className="kpi"><div className="v">{mk(d.data.earnings.pendingNetMinor)}</div><div className="l">{t("inst.owedToYou")}</div></Card>}
      <Card title={t("inst.payoutTitle")}>
        <div className="grid two">
          <Field label={t("inst.payoutProvider")}><select value={prov} onChange={(e) => setProv(e.target.value)}><option value="" />{["AIRTEL_MONEY", "MPAMBA"].map((p) => <option key={p} value={p}>{t(`provider.${p}`)}</option>)}</select></Field>
          <Field label={t("inst.payoutPhone")}><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></Field>
        </div>
        <Btn busy={busy} onClick={() => run(() => patch("/institution/me", { payoutProvider: prov || undefined, payoutPhone: phone || undefined }), t("common.saved"))}>{t("common.save")}</Btn>
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      </Card>
      <Card title={t("inst.earnHistory")}>
        {s.data?.length === 0 && <Empty />}
        <div className="tblwrap"><table className="tbl"><thead><tr><th>{t("inst.earnPeriod")}</th><th>{t("set.gross")}</th><th>{t("set.commission")}</th><th>{t("set.net")}</th><th>{t("common.status")}</th><th>{t("inst.paidRef")}</th></tr></thead>
          <tbody>{s.data?.map((x) => <tr key={x.id}><td>{dt(x.periodStart)}</td><td>{mk(x.grossFeesMinor)}</td><td>{mk(x.commissionMinor)}</td><td><strong>{mk(x.netPayableMinor)}</strong></td><td>{x.status}</td><td>{x.payoutRef ?? ""}</td></tr>)}</tbody></table></div>
      </Card>
    </Page>
  );
}
