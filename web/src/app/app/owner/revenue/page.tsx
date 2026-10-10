"use client";
import { useEffect, useState } from "react";
import { put } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Btn, Card, Field, Loading, Msg, Page, dt, mk, useBusy, useLoad } from "@/lib/ui";

export default function Revenue() {
  const { t } = useT();
  const hist = useLoad<any[]>("/admin/revenue-config");
  const info = useLoad<any>("/public/payment-info");
  const [com, setCom] = useState(30), [svc, setSvc] = useState(30);
  const [airtel, setAirtel] = useState(""), [mpamba, setMpamba] = useState("");
  const [ag, setAg] = useState({ AIRTEL_MONEY: { code: "", name: "" }, MPAMBA: { code: "", name: "" } });
  const a = useBusy(), b = useBusy();
  useEffect(() => { const c = hist.data?.[0]; if (c) { setCom(c.institutionCommissionBps / 100); setSvc(c.studentServiceFeeBps / 100); } }, [hist.data]);
  useEffect(() => { if (info.data) { setAirtel(info.data.AIRTEL_MONEY ?? ""); setMpamba(info.data.MPAMBA ?? ""); setAg({ AIRTEL_MONEY: { code: info.data.agents?.AIRTEL_MONEY?.code ?? "", name: info.data.agents?.AIRTEL_MONEY?.name ?? "" }, MPAMBA: { code: info.data.agents?.MPAMBA?.code ?? "", name: info.data.agents?.MPAMBA?.name ?? "" } }); } }, [info.data]);
  const fee = 10_000;

  return (
    <Page title={t("rev.title")}>
      <Card>
        <Field label={t("rev.commission")}><input type="number" min={0} max={100} step="0.01" value={com} onChange={(e) => setCom(+e.target.value)} /></Field>
        <Field label={t("rev.service")}><input type="number" min={0} max={100} step="0.01" value={svc} onChange={(e) => setSvc(+e.target.value)} /></Field>
        <p>{t("rev.example", { fee: fee.toLocaleString(), total: (fee * (1 + svc / 100)).toLocaleString(), net: (fee * (1 - com / 100)).toLocaleString(), own: (fee * (com + svc) / 100).toLocaleString() })}</p>
        <Btn busy={a.busy} onClick={() => a.run(async () => { await put("/admin/revenue-config", { institutionCommissionBps: Math.round(com * 100), studentServiceFeeBps: Math.round(svc * 100) }); await hist.reload(); }, t("rev.saved"))}>{t("common.save")}</Btn>
        {a.msg && <Msg kind={a.msg.kind}>{a.msg.text}</Msg>}
      </Card>
      <Card title={t("rev.payInfoTitle")}>
        <Field label={t("provider.AIRTEL_MONEY")}><input value={airtel} onChange={(e) => setAirtel(e.target.value)} inputMode="tel" /></Field>
        <Field label={t("provider.MPAMBA")}><input value={mpamba} onChange={(e) => setMpamba(e.target.value)} inputMode="tel" /></Field>
        {(["AIRTEL_MONEY", "MPAMBA"] as const).map((k) => (
          <div key={k} className="grid two">
            <Field label={`${t(`provider.${k}`)} — ${t("fam.agentCode")}`}><input value={ag[k].code} maxLength={30} onChange={(e) => setAg({ ...ag, [k]: { ...ag[k], code: e.target.value } })} /></Field>
            <Field label={`${t(`provider.${k}`)} — ${t("fam.agentName")}`}><input value={ag[k].name} maxLength={80} onChange={(e) => setAg({ ...ag, [k]: { ...ag[k], name: e.target.value } })} /></Field>
          </div>
        ))}
        <Btn busy={b.busy} onClick={() => b.run(() => put("/admin/payment-info", { ...(airtel && { AIRTEL_MONEY: airtel }), ...(mpamba && { MPAMBA: mpamba }), agents: Object.fromEntries(Object.entries(ag).filter(([, v]) => v.code)) }), t("common.saved"))}>{t("common.save")}</Btn>
        {b.msg && <Msg kind={b.msg.kind}>{b.msg.text}</Msg>}
      </Card>
      <Card title={t("rev.history")}>
        <Loading error={hist.error} loading={hist.loading} />
        <div className="tblwrap"><table className="tbl"><thead><tr><th>{t("rev.from")}</th><th>%</th><th>%</th></tr></thead>
          <tbody>{hist.data?.map((c) => <tr key={c.id}><td>{dt(c.effectiveFrom)}</td><td>{c.institutionCommissionBps / 100}</td><td>{c.studentServiceFeeBps / 100}</td></tr>)}</tbody></table></div>
      </Card>
    </Page>
  );
}
