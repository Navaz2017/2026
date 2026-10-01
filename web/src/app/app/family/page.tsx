"use client";
import { useEffect, useState } from "react";
import { patch, post, put } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Btn, Card, Empty, Field, Loading, Msg, Page, dt, useBusy, useLoad } from "@/lib/ui";

export default function Family() {
  const { t } = useT();
  const { user } = useSession();
  const kids = useLoad<any[]>("/me/students");
  const { busy, msg, run } = useBusy();
  const [f, setF] = useState({ fullName: "", dateOfBirth: "", gender: "M", currentSchoolName: "" });
  const [job, setJob] = useState("");
  const isParent = user?.role === "PARENT";
  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...f, [k]: e.target.value });
  const mine = kids.data?.[0];
  const [dob, setDob] = useState("");
  useEffect(() => { if (!isParent && mine) setDob(mine.dateOfBirth?.slice(0, 10) === "1970-01-01" ? "" : mine.dateOfBirth?.slice(0, 10) ?? ""); }, [isParent, mine]);

  return (
    <Page title={isParent ? t("nav.children") : t("nav.myDocs")}>
      <Loading error={kids.error} loading={kids.loading} />
      {isParent && <>
        <Card title={t("fam.myJob")}>
          <div className="row"><input value={job} onChange={(e) => setJob(e.target.value)} placeholder={t("auth.occupation")} style={{ maxWidth: 320 }} />
            <Btn busy={busy} disabled={job.length < 2} onClick={() => run(() => put("/me/parent/profile", { occupation: job }), t("common.saved"))}>{t("common.save")}</Btn></div>
        </Card>
        <Card title={t("fam.addChild")}>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await post("/me/children", { fullName: f.fullName, dateOfBirth: f.dateOfBirth, gender: f.gender, currentSchoolName: f.currentSchoolName || undefined }); setF({ ...f, fullName: "" }); await kids.reload(); }); }}>
            <div className="grid two">
              <Field label={t("auth.fullName")}><input required value={f.fullName} onChange={set("fullName")} /></Field>
              <Field label={t("fam.dob")}><input type="date" required value={f.dateOfBirth} onChange={set("dateOfBirth")} /></Field>
              <Field label={t("fam.gender")}><select value={f.gender} onChange={set("gender")}><option value="M">{t("fam.boy")}</option><option value="F">{t("fam.girl")}</option></select></Field>
              <Field label={t("fam.currentSchool")}><input value={f.currentSchoolName} onChange={set("currentSchoolName")} /></Field>
            </div>
            <Btn busy={busy}>{t("common.add")}</Btn>
          </form>
        </Card>
        {kids.data?.length === 0 && <Empty />}
        {kids.data?.map((k) => <Card key={k.id}><strong>{k.fullName}</strong> <span className="muted">· {dt(k.dateOfBirth)} · {k.currentSchoolName ?? ""}</span></Card>)}
      </>}
      {!isParent && mine && <Card title={t("auth.fullName") + ": " + mine.fullName}>
        <Field label={t("fam.dob")}><input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></Field>
        <Btn busy={busy} disabled={!dob} onClick={() => run(() => patch(`/me/students/${mine.id}`, { dateOfBirth: dob }), t("common.saved"))}>{t("common.save")}</Btn>
      </Card>}
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
    </Page>
  );
}
