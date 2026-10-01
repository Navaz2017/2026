"use client";
import { post, uploadFile } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Btn, Card, Empty, Loading, Msg, Page, dt, useBusy, useLoad } from "@/lib/ui";

export default function Grades() {
  const { t } = useT();
  const { data, error, loading, reload } = useLoad<any[]>("/institution/grade-requests");
  const { busy, msg, run } = useBusy();
  return (
    <Page title={t("nav.grades")}>
      <p className="muted">{t("inst.gradesIntro")}</p>
      <Loading error={error} loading={loading} />
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {data?.length === 0 && <Empty />}
      {data?.map((g) => (
        <Card key={g.id}>
          <strong>{g.student.fullName}</strong> <span className="muted">· {dt(g.student.dateOfBirth)}</span>
          <div className="row" style={{ marginTop: ".5rem" }}>
            <label className="btn primary">{t("inst.uploadReport")}
              <input type="file" hidden accept="application/pdf,image/jpeg,image/png" onChange={(e) => {
                const file = e.target.files?.[0]; if (!file) return;
                run(async () => { await uploadFile(`/institution/grade-requests/${g.id}/upload-url`, `/institution/grade-requests/${g.id}/fulfil`, file); await reload(); }, t("common.saved"));
              }} />
            </label>
            <Btn kind="danger" busy={busy} onClick={() => run(async () => { await post(`/institution/grade-requests/${g.id}/decline`, {}); await reload(); })}>{t("inst.decline")}</Btn>
          </div>
        </Card>
      ))}
    </Page>
  );
}
