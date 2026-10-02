"use client";
import { useState } from "react";
import { api, del, post } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { useT } from "@/lib/i18n";
import { Badge, Btn, Card, Empty, Field, Loading, Msg, Page, confirmBox, mk, openSigned, useBusy, useLoad } from "@/lib/ui";

function PayForm({ a, info, onDone }: { a: any; info: any; onDone: () => void }) {
  const { t } = useT();
  const [provider, setProvider] = useState("AIRTEL_MONEY"), [reference, setReference] = useState(""), [phone, setPhone] = useState("");
  const { busy, msg, run } = useBusy();
  const [done, setDone] = useState(false);
  const number = info?.[provider];
  if (done) return <Msg kind="ok">{t("fam.afterPay")}</Msg>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => { await post(`/me/applications/${a.id}/payment`, { provider, reference, payerPhone: phone }); setDone(true); onDone(); }); }}>
      <p>{t("fam.payHow", { amount: mk(a.totalDueMinor) })}</p>
      <div className="grid two">
        <Field label={t("fam.provider")}><select value={provider} onChange={(e) => setProvider(e.target.value)}>{["AIRTEL_MONEY", "MPAMBA"].map((p) => <option key={p} value={p}>{t(`provider.${p}`)}</option>)}</select></Field>
        <Field label={t("fam.sendTo")}><div className="mono" style={{ fontSize: "1.3rem", fontWeight: 700 }}>{number ?? "—"}</div></Field>
        <Field label={t("fam.reference")}><input required minLength={6} maxLength={30} value={reference} onChange={(e) => setReference(e.target.value)} autoCapitalize="characters" /></Field>
        <Field label={t("fam.payerPhone")}><input required type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0999 123 456" /></Field>
      </div>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Btn busy={busy}>{t("fam.iPaid")}</Btn>
    </form>
  );
}

export default function MyApplications() {
  const { t } = useT();
  const { data, error, loading, reload } = useLoad<any[]>("/me/applications");
  const info = useLoad<any>("/public/payment-info");
  const { busy, msg, run } = useBusy();
  return (
    <Page title={t("nav.myApps")}>
      <Loading error={error} loading={loading} />
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {data?.length === 0 && <Empty />}
      {data?.map((a) => (
        <Card key={a.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div><strong>{a.program.title}</strong> <span className="muted">· {a.program.institution.name}</span><div className="muted">{a.student.fullName}</div></div>
            <Badge ns="st.app" value={a.status} />
          </div>
          <div className="muted">{t("fam.fee")}: {mk(a.feeMinor)} + {t("fam.serviceFee")}: {mk(a.studentServiceFeeMinor)} = <strong>{t("fam.totalToPay")}: {mk(a.totalDueMinor)}</strong></div>
          {a.status === "AWAITING_PAYMENT" && <div style={{ marginTop: ".75rem" }}>
            <h2>{t("fam.payTitle")}</h2>
            <PayForm a={a} info={info.data} onDone={reload} />
            <Btn kind="ghost" busy={busy} onClick={() => confirmBox(t("fam.withdraw") + "?") && run(async () => { await del(`/me/applications/${a.id}`); await reload(); })}>{t("fam.withdraw")}</Btn>
          </div>}
          {a.status === "PAYMENT_SUBMITTED" && <Msg kind="info">{t("fam.afterPay")}</Msg>}
          {a.letter && <Btn busy={busy} onClick={() => run(() => openSigned(async () => (await api(`/me/applications/${a.id}/letter`)).url))}><Icon name="doc" size={18} /> {t("fam.letter")}</Btn>}
          {a.decisionNote && <p className="muted">“{a.decisionNote}”</p>}
        </Card>
      ))}
    </Page>
  );
}
