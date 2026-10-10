"use client";
import { useEffect, useState } from "react";
import { put } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Btn, Card, Empty, Loading, Msg, Page, useBusy, useLoad } from "@/lib/ui";

const STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];
const today = () => new Date().toISOString().slice(0, 10);

export default function Attendance() {
  const { t } = useT();
  const classes = useLoad<any[]>("/school/classes");
  const [classId, setClassId] = useState("");
  const [date, setDate] = useState(today());
  const sheet = useLoad<any>(classId ? `/school/classes/${classId}/attendance?date=${date}` : null, [classId, date]);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const { busy, msg, run } = useBusy();
  useEffect(() => { if (!classId && classes.data?.[0]) setClassId(classes.data[0].id); }, [classes.data, classId]);
  useEffect(() => { setMarks(Object.fromEntries((sheet.data?.students ?? []).map((s: any) => [s.enrolmentId, s.status ?? "PRESENT"]))); }, [sheet.data]);
  return (
    <Page title={t("nav.attendance")}>
      <div className="row">
        <select value={classId} onChange={(e) => setClassId(e.target.value)}>{classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </div>
      <Loading error={sheet.error} loading={sheet.loading} />
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {sheet.data?.students.length === 0 && <Empty />}
      {sheet.data && sheet.data.students.length > 0 && <Card>
        <p className="muted">{t("sh.absentNotify")}</p>
        {sheet.data.students.map((s: any) => (
          <div key={s.enrolmentId} className="row" style={{ justifyContent: "space-between" }}>
            <span>{s.name} <span className="muted">{s.admissionNo}</span></span>
            <select value={marks[s.enrolmentId] ?? "PRESENT"} onChange={(e) => setMarks({ ...marks, [s.enrolmentId]: e.target.value })}>{STATUSES.map((x) => <option key={x} value={x}>{t(`sh.att.${x}`)}</option>)}</select>
          </div>
        ))}
        <Btn busy={busy} onClick={() => run(async () => { await put(`/school/classes/${classId}/attendance`, { date, marks: Object.entries(marks).map(([enrolmentId, status]) => ({ enrolmentId, status })) }); await sheet.reload(); }, t("common.saved"))}>{t("common.save")}</Btn>
      </Card>}
    </Page>
  );
}
