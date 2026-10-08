import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useT } from "../../src/i18n";
import { useResource } from "../../src/offline";
import { Badge, C, Card, Empty, Loading, P, Screen, mk, toneFor } from "../../src/ui";

export default function Applications() {
  const { t } = useT();
  const router = useRouter();
  const { data, error, loading } = useResource<any[]>("/me/applications");
  return (
    <Screen>
      <Loading error={error} loading={loading && !data} />
      {data?.length === 0 && <Empty />}
      {data?.map((a) => (
        <Pressable key={a.id} accessibilityRole="button" testID={`app-${a.id}`} onPress={() => router.push(a.status === "DRAFT" ? `/apply/${a.id}` : `/application/${a.id}`)}>
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: "700", color: C.ink }}>{a.program.title}</Text>
                <P muted>{a.program.institution.name}</P><P muted>{a.student.fullName}</P>
              </View>
              <Badge label={t(`st.app.${a.status}`)} tone={toneFor(a.status)} />
            </View>
            <P muted>{t("fam.totalToPay")}: <Text style={{ fontWeight: "700", color: C.ink }}>{mk(a.totalDueMinor)}</Text></P>
            {a.status === "DRAFT" && <Text style={{ color: C.link, fontSize: 16, textDecorationLine: "underline" }}>{t("fam.continue")}</Text>}
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
