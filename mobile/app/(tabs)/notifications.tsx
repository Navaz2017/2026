import { useEffect } from "react";
import { Text, View } from "react-native";
import { post } from "../../src/api";
import { notifText, useT } from "../../src/i18n";
import { useResource } from "../../src/offline";
import { C, Card, Empty, Loading, P, Screen, dt } from "../../src/ui";

export default function Notifications() {
  const { t } = useT();
  const { data, error, loading, offline } = useResource<any[]>("/auth/notifications");
  useEffect(() => { if (data?.some((n) => !n.readAt) && !offline) post("/auth/notifications/read").catch(() => {}); }, [data, offline]);
  return (
    <Screen>
      <Loading error={error} loading={loading && !data} />
      {data?.length === 0 && <Empty />}
      {data?.map((n) => {
        return (
          <Card key={n.id} style={n.readAt ? undefined : { borderLeftWidth: 4, borderLeftColor: C.gold }}>
            <View><Text style={{ fontSize: 16, color: C.ink, lineHeight: 23 }}>{notifText(t, n)}</Text><P muted>{dt(n.createdAt)}</P></View>
          </Card>
        );
      })}
    </Screen>
  );
}
