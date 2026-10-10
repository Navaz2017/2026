"use client";
import { useEffect, useState } from "react";
import { downloadBlob, post, put } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Btn, Card, Empty, Field, Loading, Msg, Page, confirmBox, useBusy, useLoad } from "@/lib/ui";

export default function Results() {
  const { t } = useT();
  const list = useLoad<any[]>("/school/assessments");
  const classes = useLoad<any[]>("/school/classes");
  const subjects = useLoad<any[]>("/school/subjects");
  const [open, setOpen] = useState<string | null>(null);
  const { busy, msg, run } = useBusy();
  const [f, setF] = useState({ classId: "", subjectId: "", termNo: "1", title: "", type: "TEST", maxScore: "100" });
  const det = useLoad<any>(open ? `/school/assessments/${open}` : null, [open]);
  const [rows, setRows] = useState<Record<string, { score: string; feedback: string }>>({});
  useEffect(() => { setRows(Object.fromEntries((det.data?.rows ?? []).map((r: any) => [r.enrolmentId, { score: r.score ?? "", feedback: r.feedback ?? "" }]))); }, [det.data]);
  const a = det.data?.assessment;
  const save = () => run(async () => {
    await put(`/school/assessments/${open}/grades`, { grades: Object.entries(rows).map(([enrolmentId, v]) => ({ enrolmentId, score: v.score === "" ? null : Number(v.score), feedback: v.feedback || null })) });
    await det.reload();
  }, t("common.saved"));
  const csv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
    run(async () => { await post(`/school/assessments/${open}/grades/csv`, { csv: await file.text() }); await det.reload(); }, t("common.saved"));
  };

  if (open) return (
    <Page title={a ? `${a.title}` : t("nav.results")} actions={<Btn kind="ghost" onClick={() => { setOpen(null); list.reload(); }}>←</Btn>}>
      <Loading error={det.error} loading={det.loading} />
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {a && <>
        <p className="muted">{t("sh.maxScore")}: {a.maxScore} · {a.publishedAt ? t("sh.published") : t("sh.draft")}</p>
        <div className="row">
          <Btn kind="ghost" onClick={() => downloadBlob(`/school/assessments/${open}/template.csv`, "grades.csv")}>{t("sh.template")}</Btn>
          <label className="btn">{t("sh.chooseCsv")}<input type="file" hidden accept=".csv,text/csv,text/plain" onChange={csv} /></label>
        </div>
        <Card>
          {det.data.rows.map((r: any) => (
            <div key={r.enrolmentId} className="row">
              <span style={{ minWidth: 160 }}>{r.name}</span>
              <input type="number" min={0} max={a.maxScore} style={{ width: 90 }} value={rows[r.enrolmentId]?.score ?? ""} onChange={(e) => setRows({ ...rows, [r.enrolmentId]: { ...rows[r.enrolmentId]!, score: e.target.value } })} />
              <input style={{ flex: 1, minWidth: 200 }} placeholder={t("sh.feedback")} maxLength={1000} value={rows[r.enrolmentId]?.feedback ?? ""} onChange={(e) => setRows({ ...rows, [r.enrolmentId]: { ...rows[r.enrolmentId]!, feedback: e.target.value } })} />
            </div>
          ))}
          <div className="row"><Btn busy={busy} onClick={save}>{t("common.save")}</Btn>
            {!a.publishedAt && <Btn busy={busy} kind="ghost" onClick={() => confirmBox(t("sh.confirmPublish")) && run(async () => { await save(); await post(`/school/assessments/${open}/publish`); await det.reload(); }, t("sh.published"))}>{t("sh.publish")}</Btn>}</div>
        </Card>
      </>}
    </Page>
  );

  return (
    <Page title={t("nav.results")}>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Card title={t("sh.newAssessment")}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await post("/school/assessments", { ...f, termNo: Number(f.termNo), maxScore: Number(f.maxScore) }); setOpen(r.id); }); }}>
          <select required value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })}><option value="">{t("sh.class")}</option>{classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select required value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })}><option value="">{t("sh.subject")}</option>{subjects.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select value={f.termNo} onChange={(e) => setF({ ...f, termNo: e.target.value })}>{[1, 2, 3].map((n) => <option key={n} value={n}>{t("sh.term")} {n}</option>)}</select>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{["TEST", "EXAM", "ASSIGNMENT"].map((x) => <option key={x} value={x}>{t(`sh.type.${x}`)}</option>)}</select>
          <Field label={t("sh.title")}><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label={t("sh.maxScore")}><input type="number" min={1} max={1000} style={{ width: 90 }} value={f.maxScore} onChange={(e) => setF({ ...f, maxScore: e.target.value })} /></Field>
          <Btn busy={busy}>{t("common.add")}</Btn>
        </form>
      </Card>
      <Loading error={list.error} loading={list.loading} />
      {list.data?.length === 0 && <Empty />}
      {list.data?.map((x) => (
        <Card key={x.id} title={x.title}>
          <p className="muted">{x.class.name} · {x.subject.name} · {t("sh.term")} {x.termNo} · {x.publishedAt ? t("sh.published") : t("sh.draft")}</p>
          <Btn kind="ghost" onClick={() => setOpen(x.id)}>{t("sh.open")}</Btn>
        </Card>
      ))}
    </Page>
  );
}
