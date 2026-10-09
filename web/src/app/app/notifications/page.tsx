"use client";
import { useEffect } from "react";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Card, Empty, Loading, Page, dtt, useLoad } from "@/lib/ui";
import { useLiveReload } from "@/lib/realtime";

export default function Notifications() {
  const { t } = useT();
  const { data, error, loading, reload } = useLoad<any[]>("/auth/notifications");
  useLiveReload(reload, ["notification", "ready"]);
  useEffect(() => { if (data?.some((n) => !n.readAt)) post("/auth/notifications/read").catch(() => {}); }, [data]);
  return (
    <Page title={t("nav.notifications")}>
      <Loading error={error} loading={loading} />
      {data?.length === 0 && <Empty />}
      {data?.map((n) => (
        <Card key={n.id}><strong>{!n.readAt && "● "}{t(`notif.${n.type}`) === `notif.${n.type}` ? n.type : t(`notif.${n.type}`)}</strong><div className="muted">{dtt(n.createdAt)}</div></Card>
      ))}
    </Page>
  );
}
