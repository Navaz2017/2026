"use client";
import { useState } from "react";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Badge, Btn, Card, Empty, Field, Loading, Msg, Page, dtt, mk, useBusy, useLoad } from "@/lib/ui";

export default function Payments() {
  const { t } = useT();
  const [tab, setTab] = useState<"pay" | "sms">("pay");
  const [status, setStatus] = useState("PENDING"), [q, setQ] = useState("");
  const pays = useLoad<any[]>(tab === "pay" ? `/admin/payments?status=${status}&q=${encodeURIComponent(q)}` : null, [tab, status, q]);
  const sms = useLoad<any[]>(tab === "sms" ? "/admin/sms/unmatched" : null, [tab]);
  const { busy, msg, run } = useBusy();

  const withReason = (id: string, action: "manual-confirm" | "reject") => {
    const reason = window.prompt(t("pay.reasonPrompt"));
    if (reason) run(async () => { await post(`/admin/payments/${id}/${action}`, { reason }); await pays.reload(); });
  };

  return (
    <Page title={t("nav.payments")}>
      <div className="tabs">
        <button className={`tab ${tab === "pay" ? "on" : ""}`} onClick={() => setTab("pay")}>{t("pay.tabPayments")}</button>
        <button className={`tab ${tab === "sms" ? "on" : ""}`} onClick={() => setTab("sms")}>{t("pay.tabSms")}</button>
      </div>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {tab === "pay" && <>
        <div className="tabs">{["PENDING", "UNDERPAID", "CONFIRMED", "REJECTED"].map((s) => <button key={s} className={`tab ${s === status ? "on" : ""}`} onClick={() => setStatus(s)}>{t(`st.pay.${s}`)}</button>)}</div>
        <Field label={t("pay.search")}><input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Loading error={pays.error} loading={pays.loading} />
        {pays.data?.length === 0 && <Empty />}
        {pays.data?.map((p) => (
          <Card key={p.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <strong>{p.application.student.fullName}</strong> <span className="muted">→ {p.application.program.institution.name} · {p.application.program.title}</span>
                <div>{t(`provider.${p.provider}`)} · <span className="mono">{p.reference}</span> · {t("pay.payer")} {p.payerPhone}</div>
                <div className="muted">{t("pay.due")}: {mk(p.application.totalDueMinor)}{p.sms?.amountMinor != null && ` · SMS: ${mk(p.sms.amountMinor)}`} · {dtt(p.createdAt)}</div>
                {p.manualReason && <div className="muted">“{p.manualReason}”</div>}
              </div>
              <Badge ns="st.pay" value={p.status} />
            </div>
            {(p.status === "PENDING" || p.status === "UNDERPAID") && <div className="row" style={{ marginTop: ".5rem" }}>
              <Btn kind="ghost" busy={busy} onClick={() => run(async () => { await post(`/admin/payments/${p.id}/retry-match`); await pays.reload(); })}>{t("pay.retry")}</Btn>
              <Btn busy={busy} onClick={() => withReason(p.id, "manual-confirm")}>{t("pay.manual")}</Btn>
              <Btn kind="danger" busy={busy} onClick={() => withReason(p.id, "reject")}>{t("pay.reject")}</Btn>
            </div>}
          </Card>
        ))}
      </>}
      {tab === "sms" && <>
        <Loading error={sms.error} loading={sms.loading} />
        {sms.data?.length === 0 && <Empty />}
        <div className="tblwrap">{sms.data && sms.data.length > 0 && <table className="tbl"><thead><tr><th>{t("pay.received")}</th><th>{t("pay.reference")}</th><th>{t("common.amount")}</th><th>{t("pay.nameInSms")}</th><th>{t("pay.message")}</th></tr></thead>
          <tbody>{sms.data.map((m) => <tr key={m.id}><td>{dtt(m.receivedAt)}</td><td className="mono">{m.reference ?? "—"}</td><td>{m.amountMinor != null ? mk(m.amountMinor) : "—"}</td><td>{m.payerName ?? ""}</td><td>{m.rawBody}</td></tr>)}</tbody></table>}</div>
      </>}
    </Page>
  );
}
