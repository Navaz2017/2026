"use client";
import { useState } from "react";
import { patch, post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Badge, Btn, Card, Empty, Field, Loading, Msg, Page, dt, mk, useBusy, useLoad } from "@/lib/ui";

export default function Programs() {
  const { t } = useT();
  const { data, error, loading, reload } = useLoad<any[]>("/institution/programs");
  const { busy, msg, run } = useBusy();
  const [f, setF] = useState({ title: "", level: "", description: "", seats: "30", fee: "10000", opensAt: "", closesAt: "" });
  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...f, [k]: e.target.value });
  return (
    <Page title={t("nav.programs")}>
      <Msg kind="info">{t("inst.earlyNote")}</Msg>
      <Card title={t("inst.addProgram")}>
        <form onSubmit={(e) => { e.preventDefault(); run(async () => {
          await post("/institution/programs", { title: f.title, level: f.level, description: f.description || undefined, seats: +f.seats, applicationFee: Math.round(+f.fee * 100), opensAt: f.opensAt || undefined, closesAt: f.closesAt || undefined });
          setF({ ...f, title: "", description: "" }); await reload();
        }); }}>
          <div className="grid two">
            <Field label={t("inst.progTitle")}><input required value={f.title} onChange={set("title")} /></Field>
            <Field label={t("inst.level")}><input required value={f.level} onChange={set("level")} /></Field>
            <Field label={t("inst.seatsF")}><input type="number" min={1} required value={f.seats} onChange={set("seats")} /></Field>
            <Field label={t("inst.fee")}><input type="number" min={0} step="0.01" required value={f.fee} onChange={set("fee")} /></Field>
            <Field label={t("inst.opens")}><input type="date" value={f.opensAt} onChange={set("opensAt")} /></Field>
            <Field label={t("inst.closes")}><input type="date" value={f.closesAt} onChange={set("closesAt")} /></Field>
          </div>
          <Field label={t("inst.description")}><textarea style={{ minHeight: 80 }} value={f.description} onChange={set("description")} /></Field>
          {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
          <Btn busy={busy}>{t("common.add")}</Btn>
        </form>
      </Card>
      <Loading error={error} loading={loading} />
      {data?.length === 0 && <Empty />}
      {data?.map((p) => (
        <Card key={p.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div><strong>{p.title}</strong> <span className="muted">· {p.level}</span>
              <div className="muted">{mk(p.applicationFee)} · {t("inst.seatsUsed", { used: p.seatsTaken, total: p.seats })}{p.closesAt && ` · ${t("inst.closes")}: ${dt(p.closesAt)}`}</div></div>
            <div className="row"><Badge ns="st.prog" value={p.status} />{p.status !== "CLOSED" && <Btn kind="ghost" busy={busy} onClick={() => run(async () => { await patch(`/institution/programs/${p.id}`, { status: "CLOSED" }); await reload(); })}>{t("inst.closeProg")}</Btn>}</div>
          </div>
        </Card>
      ))}
    </Page>
  );
}
