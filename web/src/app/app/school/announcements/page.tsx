"use client";
import { useState } from "react";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Btn, Card, Empty, Field, Loading, Msg, Page, dtt, useBusy, useLoad } from "@/lib/ui";

export default function Announcements() {
  const { t } = useT();
  const { user } = useSession();
  const list = useLoad<any[]>("/school/announcements");
  const classes = useLoad<any[]>("/school/classes");
  const { busy, msg, run, setMsg } = useBusy();
  const admin = user?.role === "INSTITUTION_ADMIN";
  const [f, setF] = useState({ title: "", body: "", audience: admin ? "SCHOOL" : "CLASS", classIds: [] as string[], urgent: false, alsoWhatsApp: false });
  const toggle = (id: string) => setF({ ...f, classIds: f.classIds.includes(id) ? f.classIds.filter((x) => x !== id) : [...f.classIds, id] });
  return (
    <Page title={t("nav.notices")}>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Card title={t("sh.newNotice")}>
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await post("/school/announcements", f); setMsg({ kind: "ok", text: t("sh.sent", { n: r.inApp, w: r.whatsapp }) }); setF({ ...f, title: "", body: "" }); await list.reload(); }); }}>
          {admin && <Field label={t("sh.audience")}><select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="SCHOOL">{t("sh.wholeSchool")}</option><option value="CLASS">{t("sh.selectedClasses")}</option></select></Field>}
          {f.audience === "CLASS" && <div className="row">{classes.data?.map((c) => <label key={c.id}><input type="checkbox" checked={f.classIds.includes(c.id)} onChange={() => toggle(c.id)} /> {c.name}</label>)}</div>}
          <Field label={t("sh.title")}><input required maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label={t("sh.message")}><textarea required rows={4} maxLength={2000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <label><input type="checkbox" checked={f.urgent} onChange={(e) => setF({ ...f, urgent: e.target.checked })} /> {t("sh.urgent")}</label><br />
          <label><input type="checkbox" checked={f.alsoWhatsApp} onChange={(e) => setF({ ...f, alsoWhatsApp: e.target.checked })} /> {t("sh.alsoWhatsApp")}</label>
          <div><Btn busy={busy}>{t("sh.send")}</Btn></div>
        </form>
      </Card>
      <Loading error={list.error} loading={list.loading} />
      {list.data?.length === 0 && <Empty />}
      {list.data?.map((a) => (
        <Card key={a.id} title={`${a.urgent ? "⚠ " : ""}${a.title}`}>
          <p>{a.body}</p><p className="muted">{dtt(a.createdAt)} · {t("sh.readBy", { r: a.reads, n: a.recipients })}</p>
        </Card>
      ))}
    </Page>
  );
}
