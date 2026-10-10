"use client";
import { useState } from "react";
import { downloadBlob, post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Btn, Card, Loading, Msg, Page, dtt, confirmBox, useBusy, useLoad } from "@/lib/ui";

export default function Roster() {
  const { t } = useT();
  const imports = useLoad<any[]>("/school/roster/imports");
  const { busy, msg, run } = useBusy();
  const [prev, setPrev] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
    run(async () => { setDone(null); setPrev(await post("/school/roster/preview", { csv: await file.text(), fileName: file.name })); });
  };
  return (
    <Page title={t("sh.roster")}>
      <p className="muted">{t("sh.rosterIntro")}</p>
      <div className="row">
        <Btn kind="ghost" onClick={() => downloadBlob("/school/roster/template.csv", "enrolla-roster-template.csv")}>{t("sh.template")}</Btn>
        <label className="btn primary">{t("sh.chooseCsv")}<input type="file" hidden accept=".csv,text/csv,text/plain" onChange={onFile} /></label>
      </div>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {done && <Msg kind="ok">{t("sh.imported", { n: done.students ?? done.enrolments ?? 0 })}</Msg>}
      {prev && <Card title={t("sh.preview")}>
        <p>{t("sh.previewSummary", { rows: prev.summary.rows, guardians: prev.summary.guardians, classes: prev.summary.classes.length })}</p>
        {prev.errors.length > 0 && <Msg kind="err">{t("sh.fixErrors", { n: prev.summary.errors })}<ul>{prev.errors.slice(0, 30).map((x: any, i: number) => <li key={i}>{typeof x === "string" ? x : `${x.row ?? ""} ${x.field ?? ""} ${x.message ?? x.error ?? ""}`}</li>)}</ul></Msg>}
        {prev.warnings.length > 0 && <Msg kind="warn"><ul>{prev.warnings.slice(0, 20).map((x: any, i: number) => <li key={i}>{typeof x === "string" ? x : `${x.row ?? ""} ${x.message ?? ""}`}</li>)}</ul></Msg>}
        <Btn busy={busy} disabled={prev.summary.errors > 0} onClick={() => run(async () => { setDone(await post(`/school/roster/${prev.id}/commit`)); setPrev(null); await imports.reload(); })}>{t("sh.commit")}</Btn>
      </Card>}
      <Card title={t("sh.history")}>
        <Loading error={imports.error} loading={imports.loading} />
        {imports.data?.map((i) => (
          <div key={i.id} className="row" style={{ justifyContent: "space-between" }}>
            <span>{i.fileName ?? "—"} · {i.status} · {dtt(i.createdAt)}</span>
            {i.status === "COMMITTED" && <Btn kind="danger" busy={busy} onClick={() => confirmBox(t("sh.confirmRollback")) && run(async () => { await post(`/school/roster/${i.id}/rollback`); await imports.reload(); })}>{t("sh.rollback")}</Btn>}
          </div>
        ))}
      </Card>
    </Page>
  );
}
