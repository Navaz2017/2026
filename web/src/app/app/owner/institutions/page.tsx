"use client";
import { useState } from "react";
import { api, post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Badge, Btn, Card, Empty, Field, Loading, Msg, Page, confirmBox, dt, openSigned, useBusy, useLoad } from "@/lib/ui";

const STATUSES = ["UNDER_REVIEW", "PENDING", "VERIFIED", "REJECTED", "SUSPENDED"];

export default function Verification() {
  const { t } = useT();
  const [status, setStatus] = useState("UNDER_REVIEW"), [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null), [note, setNote] = useState("");
  const { data, error, loading, reload } = useLoad<any[]>(`/admin/institutions?status=${status}&q=${encodeURIComponent(q)}`);
  const { busy, msg, run } = useBusy();

  const decide = (id: string, decision: "VERIFIED" | "REJECTED" | "SUSPENDED") => {
    if (decision !== "REJECTED" && !confirmBox(t(decision === "VERIFIED" ? "ver.confirmVerify" : "ver.confirmSuspend"))) return;
    run(async () => { await post(`/admin/institutions/${id}/review`, { decision, note: note || undefined }); setOpen(null); setNote(""); await reload(); });
  };
  const openDoc = (id: string) => run(() => openSigned(async () => (await api(`/admin/documents/${id}/download`)).url));

  return (
    <Page title={t("nav.verification")}>
      <div className="tabs">{STATUSES.map((s) => <button key={s} className={`tab ${s === status ? "on" : ""}`} onClick={() => setStatus(s)}>{t(`st.inst.${s}`)}</button>)}</div>
      <Field label={t("common.search")}><input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      <Loading error={error} loading={loading} />
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {data?.length === 0 && <Empty />}
      {data?.map((i) => (
        <Card key={i.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div><strong>{i.name}</strong> <span className="muted">· {t(`type.${i.type}`)} · {i.district ?? ""}</span><div className="muted">{t("ver.programs", { n: i._count.programs })} · {dt(i.updatedAt)}</div></div>
            <div className="row"><Badge ns="st.inst" value={i.status} /><Btn kind="ghost" onClick={() => setOpen(open === i.id ? null : i.id)}>{t("common.view")}</Btn></div>
          </div>
          {open === i.id && <div style={{ marginTop: ".75rem" }}>
            <h2>{t("ver.contacts")}</h2>
            {i.users.map((u: any, k: number) => <div key={k}>{u.fullName} · {u.email} · {u.phone ?? ""}</div>)}
            <h2 style={{ marginTop: ".75rem" }}>{t("ver.docs")}</h2>
            {i.documents.length === 0 && <Empty />}
            {i.documents.map((d: any) => <div key={d.id} className="row"><span>{t(`doc.${d.kind}`) === `doc.${d.kind}` ? d.kind : t(`doc.${d.kind}`)} · {dt(d.createdAt)}</span><Btn kind="ghost" onClick={() => openDoc(d.id)}>{t("ver.openDoc")}</Btn></div>)}
            <Field label={t("ver.note")}><textarea style={{ minHeight: 80 }} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="row">
              <Btn busy={busy} onClick={() => decide(i.id, "VERIFIED")}>{t("ver.verify")}</Btn>
              <Btn busy={busy} kind="danger" onClick={() => decide(i.id, "REJECTED")}>{t("ver.reject")}</Btn>
              {i.status === "VERIFIED" && <Btn busy={busy} kind="danger" onClick={() => decide(i.id, "SUSPENDED")}>{t("ver.suspend")}</Btn>}
            </div>
          </div>}
        </Card>
      ))}
    </Page>
  );
}
