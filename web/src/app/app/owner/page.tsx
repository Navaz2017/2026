"use client";
import { BarChart } from "@/components/BarChart";
import { useT } from "@/lib/i18n";
import { Card, Loading, Msg, Page, mk, useLoad } from "@/lib/ui";

export default function OwnerDashboard() {
  const { t } = useT();
  const d = useLoad<any>("/admin/dashboard");
  const ts = useLoad<any[]>("/admin/stats/timeseries?months=12");
  const x = d.data;
  const verified = x?.instByStatus?.find((s: any) => s.status === "VERIFIED")?._count ?? 0;
  const apps = x?.appsByStatus?.reduce((n: number, s: any) => n + s._count, 0) ?? 0;
  const alertText = (a: any) => t(`owner.alert.${a.code}`, { label: a.label ?? "", count: a.count ?? 0 });
  return (
    <Page title={t("owner.title")}>
      <Loading error={d.error} loading={d.loading} />
      {x && <>
        <div className="grid kpis" style={{ marginBottom: "1rem" }}>
          <Card className="kpi"><div className="v">{x.users.toLocaleString()}</div><div className="l">{t("owner.users")}</div></Card>
          <Card className="kpi"><div className="v">{verified}</div><div className="l">{t("owner.institutions")}</div></Card>
          <Card className="kpi"><div className="v">{apps.toLocaleString()}</div><div className="l">{t("owner.apps")}</div></Card>
          <Card className="kpi"><div className="v">{mk(x.revenue.ownerTotalMinor)}</div><div className="l">{t("owner.revenue")}</div></Card>
          <Card className="kpi"><div className="v">{mk(x.owedToInstitutionsNowMinor)}</div><div className="l">{t("owner.owed")}</div></Card>
          <Card className="kpi"><div className="v">{x.unmatchedSms}</div><div className="l">{t("owner.unmatched")}</div></Card>
        </div>
        <Card title={t("owner.alerts")}>
          {x.alerts.length === 0 ? <Msg kind="ok">{t("owner.noAlerts")}</Msg> : x.alerts.map((a: any, i: number) => <Msg key={i} kind="warn">{alertText(a)}</Msg>)}
        </Card>
        <div className="grid two">
          <Card><BarChart title={t("owner.chartStatus")} bars={x.appsByStatus.map((s: any) => ({ label: t(`st.app.${s.status}`), value: s._count }))} /></Card>
          {ts.data && <Card><BarChart title={t("owner.chartApps")} bars={ts.data.map((m) => ({ label: m.month.slice(2), value: m.applications }))} /></Card>}
        </div>
        {ts.data && <Card><BarChart title={t("owner.chartRevenue")} bars={ts.data.map((m) => ({ label: m.month.slice(2), value: m.ownerRevenueMinor / 100, display: Math.round(m.ownerRevenueMinor / 100).toLocaleString("en-US") }))} /></Card>}
      </>}
    </Page>
  );
}
