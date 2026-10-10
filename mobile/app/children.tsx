import { useState } from "react";
import { post, put } from "../src/api";
import { useT } from "../src/i18n";
import { useResource } from "../src/offline";
import { Btn, Card, DateField, Empty, Field, Loading, Msg, P, Screen, Select, dt, useBusy } from "../src/ui";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export default function Children() {
  const { t } = useT();
  const kids = useResource<any[]>("/me/students");
  const { busy, msg, run } = useBusy();
  const [f, setF] = useState({ fullName: "", dateOfBirth: "", gender: "M", currentSchoolName: "" });
  const [job, setJob] = useState("");
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  return (
    <Screen>
      <Card title={t("fam.myJob")}>
        <Field testID="job" label={t("auth.occupation")} value={job} onChange={setJob} />
        <Btn label={t("common.save")} busy={busy} disabled={job.length < 2} onPress={() => run(() => put("/me/parent/profile", { occupation: job }), t("common.saved"))} />
      </Card>
      <Card title={t("fam.addChild")}>
        <Field testID="childName" label={t("auth.fullName")} value={f.fullName} onChange={set("fullName")} required />
        <DateField testID="childDob" label={t("fam.dob")} value={f.dateOfBirth} onChange={set("dateOfBirth")} required initial="2012-01-01" />
        <Select label={t("fam.gender")} value={f.gender} onChange={set("gender")} options={[["M", t("fam.boy")], ["F", t("fam.girl")]]} />
        <Field label={t("fam.currentSchool")} value={f.currentSchoolName} onChange={set("currentSchoolName")} />
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
        <Btn testID="addChild" label={t("common.add")} busy={busy} disabled={f.fullName.length < 2 || !DATE.test(f.dateOfBirth)} onPress={() => run(async () => { await post("/me/children", { fullName: f.fullName.trim(), dateOfBirth: f.dateOfBirth, gender: f.gender, currentSchoolName: f.currentSchoolName || undefined }); setF({ ...f, fullName: "", dateOfBirth: "" }); kids.reload(); })} />
      </Card>
      <Loading error={kids.error} loading={kids.loading && !kids.data} />
      {kids.data?.length === 0 && <Empty />}
      {kids.data?.map((k) => <Card key={k.id}><P style={{ fontWeight: "700" }}>{k.fullName}</P><P muted>{dt(k.dateOfBirth)}{k.currentSchoolName ? ` · ${k.currentSchoolName}` : ""}</P></Card>)}
    </Screen>
  );
}
