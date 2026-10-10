"use client";
import { useState } from "react";
import { del, post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Btn, Card, Empty, Field, Loading, Msg, Page, useBusy, useLoad } from "@/lib/ui";

export default function Staff() {
  const { t } = useT();
  const staff = useLoad<any[]>("/school/staff");
  const classes = useLoad<any[]>("/school/classes");
  const subjects = useLoad<any[]>("/school/subjects");
  const { busy, msg, run } = useBusy();
  const [f, setF] = useState({ fullName: "", phone: "" });
  const [subj, setSubj] = useState("");
  const [a, setA] = useState({ teacherId: "", classId: "", subjectId: "" });
  return (
    <Page title={t("sh.staff")}>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Card title={t("sh.addTeacher")}>
        <p className="muted">{t("sh.teacherHint")}</p>
        <form className="row" onSubmit={(e) => { e.preventDefault(); run(async () => { await post("/school/staff", f); setF({ fullName: "", phone: "" }); await staff.reload(); }, t("common.saved")); }}>
          <Field label={t("auth.fullName")}><input required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
          <Field label={t("sh.phone")}><input required value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" /></Field>
          <Btn busy={busy}>{t("common.add")}</Btn>
        </form>
      </Card>
      <Card title={t("sh.subjects")}>
        <div className="row">{subjects.data?.map((s) => <span key={s.id} className="badge">{s.name}</span>)}</div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); run(async () => { await post("/school/subjects", { name: subj }); setSubj(""); await subjects.reload(); }); }}>
          <input required value={subj} onChange={(e) => setSubj(e.target.value)} placeholder="Mathematics" /><Btn busy={busy}>{t("common.add")}</Btn>
        </form>
      </Card>
      <Card title={t("sh.assign")}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); run(async () => { await post("/school/assignments", { teacherId: a.teacherId, classId: a.classId, subjectId: a.subjectId || null }); await staff.reload(); }, t("common.saved")); }}>
          <select required value={a.teacherId} onChange={(e) => setA({ ...a, teacherId: e.target.value })}><option value="">{t("sh.teacher")}</option>{staff.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select>
          <select required value={a.classId} onChange={(e) => setA({ ...a, classId: e.target.value })}><option value="">{t("sh.class")}</option>{classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select value={a.subjectId} onChange={(e) => setA({ ...a, subjectId: e.target.value })}><option value="">{t("sh.subject")}</option>{subjects.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <Btn busy={busy}>{t("sh.assign")}</Btn>
        </form>
      </Card>
      <Loading error={staff.error} loading={staff.loading} />
      {staff.data?.length === 0 && <Empty />}
      {staff.data?.map((s) => (
        <Card key={s.id} title={s.fullName}>
          <p className="muted">{s.phone}</p>
          {s.teaching?.map((x: any) => (
            <div key={x.id} className="row">{x.class?.name} · {x.subject?.name ?? t("sh.classTeacher")}
              <Btn kind="ghost" busy={busy} onClick={() => run(async () => { await del(`/school/assignments/${x.id}`); await staff.reload(); })}>{t("common.delete")}</Btn></div>
          ))}
        </Card>
      ))}
    </Page>
  );
}
