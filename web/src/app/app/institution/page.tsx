"use client";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { Badge, Card, Loading, Msg, Page, mk, useLoad } from "@/lib/ui";

export default function InstitutionHome() {
  const { t } = useT();
  const { data: d, error, loading } = useLoad<any>("/institution/dashboard");
  const st = d?.institution.status;
  return (
    <Page title={d?.institution.name ?? t("inst.title")}>
      <Loading error={error} loading={loading} />
      {d && <>
        {st === "PENDING" && <Msg kind="warn">{t("inst.bannerPending")} <Link href="/app/institution/documents">{t("nav.documents")}</Link></Msg>}
        {st === "UNDER_REVIEW" && <Msg kind="info">{t("inst.bannerReview")}</Msg>}
        {st === "REJECTED" && <Msg kind="err">{t("inst.bannerRejected", { note: d.institution.reviewNote ?? "" })}</Msg>}
        {st === "SUSPENDED" && <Msg kind="err">{t("inst.bannerSuspended")}</Msg>}
        <div className="row" style={{ marginBottom: "1rem" }}><Badge ns="st.inst" value={st} /> <Badge ns="st.wa" value={d.whatsapp.status} /><span className="muted">{t("nav.whatsapp")}</span></div>
        <div className="grid kpis" style={{ marginBottom: "1rem" }}>
          {["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED"].map((s) => (
            <Card key={s} className="kpi"><div className="v">{d.applicationsByStatus.find((x: any) => x.status === s)?._count ?? 0}</div><div className="l">{t(`st.app.${s}`)}</div></Card>
          ))}
          <Card className="kpi"><div className="v">{d.pendingGradeRequests}</div><div className="l">{t("inst.pendingGrades")}</div></Card>
          <Card className="kpi"><div className="v">{mk(d.earnings.pendingNetMinor)}</div><div className="l">{t("inst.owedToYou")}</div></Card>
        </div>
        <Card title={t("nav.programs")}>
          {d.programs.map((p: any) => (
            <div key={p.id} className="row" style={{ justifyContent: "space-between", padding: ".35rem 0" }}>
              <span><strong>{p.title}</strong> <span className="muted">· {t("inst.seatsUsed", { used: p.seatsTaken, total: p.seats })}</span></span>
              <Badge ns="st.prog" value={p.status} />
            </div>
          ))}
        </Card>
      </>}
    </Page>
  );
}
