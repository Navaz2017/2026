"use client";
import { useState } from "react";
import { api, post, uploadFile } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Btn, Card, Empty, Field, Loading, Msg, Page, dt, openSigned, useBusy, useLoad } from "@/lib/ui";

const KINDS = ["SCHOOL_REPORT", "MSCE", "JCE", "PSLCE", "TRANSCRIPT", "ID", "BIRTH_CERT", "OTHER"];
export default function MyDocuments() {
  const { t } = useT();
  const kids = useLoad<any[]>("/me/students");
  const [who, setWho] = useState(""), [kind, setKind] = useState("SCHOOL_REPORT"), [title, setTitle] = useState("");
  const [school, setSchool] = useState("");
  const sid = who || kids.data?.[0]?.id;
  const docs = useLoad<any[]>(sid ? `/me/students/${sid}/credentials` : null, [sid]);
  const schools = useLoad<any[]>("/public/institutions");
  const { busy, msg, run } = useBusy();

  return (
    <Page title={t("nav.myDocs")}>
      <Loading error={kids.error} loading={kids.loading} />
      {(kids.data?.length ?? 0) > 1 && <Field label={t("fam.forWhom")}><select value={sid} onChange={(e) => setWho(e.target.value)}>{kids.data!.map((k) => <option key={k.id} value={k.id}>{k.fullName}</option>)}</select></Field>}
      <Card>
        <div className="grid two">
          <Field label={t("fam.docKind")}><select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{t(`dockind.${k}`)}</option>)}</select></Field>
          <Field label={t("fam.docTitle")}><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></Field>
        </div>
        <Field label={t("common.upload")}>
          <input type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy || !sid} onChange={(e) => {
            const file = e.target.files?.[0]; if (!file || !sid) return;
            run(async () => { await uploadFile(`/me/students/${sid}/credentials/upload-url`, `/me/students/${sid}/credentials`, file, { kind, title: title || t(`dockind.${kind}`) }); setTitle(""); await docs.reload(); }, t("common.saved"));
            e.target.value = "";
          }} />
        </Field>
        {busy && <p className="muted">{t("common.uploading")}</p>}
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      </Card>
      <Loading error={docs.error} loading={docs.loading} />
      {docs.data?.length === 0 && <Empty />}
      {docs.data?.map((d) => (
        <Card key={d.id}><div className="row" style={{ justifyContent: "space-between" }}>
          <span>📄 <strong>{d.title}</strong> <span className="muted">· {t(`dockind.${d.kind}`)} · {dt(d.createdAt)}</span></span>
          <Btn kind="ghost" onClick={() => run(() => openSigned(async () => (await api(`/me/credentials/${d.id}/download`)).url))}>{t("common.view")}</Btn>
        </div></Card>
      ))}
      <Card title={t("fam.askGrades")}>
        <Field label={t("fam.chooseSchool")}><select value={school} onChange={(e) => setSchool(e.target.value)}><option value="" />{schools.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Btn busy={busy} disabled={!school || !sid} onClick={() => run(() => post(`/me/students/${sid}/grade-requests`, { fromSchoolId: school }), t("fam.gradesAsked"))}>{t("common.submit")}</Btn>
      </Card>
    </Page>
  );
}
