import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useT } from "../../src/i18n";
import { ProgramFacts } from "../../src/school";
import { useResource } from "../../src/offline";
import { Badge, Btn, C, Card, Empty, Field, Loading, P, Screen, Select, dt, mk } from "../../src/ui";

// Find a programme or class. Saved lists stay readable offline.
export default function Browse() {
  const { t } = useT();
  const router = useRouter();
  const [q, setQ] = useState(""), [type, setType] = useState("");
  const progs = useResource<any[]>(`/public/programs?q=${encodeURIComponent(q.trim())}${type ? `&type=${type}` : ""}`);
  return (
    <Screen>
      <Field testID="search" label={t("fam.search")} value={q} onChange={setQ} autoCapitalize="none" returnKeyType="search" />
      <Select label={t("auth.instType")} value={type} onChange={setType} options={[["", t("fam.allTypes")], ...["PRIMARY_SCHOOL", "SECONDARY_SCHOOL", "COLLEGE", "UNIVERSITY"].map((k): [string, string] => [k, t(`type.${k}`)])]} />
      <Loading error={progs.error} loading={progs.loading && !progs.data} />
      {progs.data?.length === 0 && <Empty />}
      {progs.data?.map((p) => {
        const left = p.seats - p.seatsTaken;
        return (
          <Card key={p.id}>
            <Badge label={t(`type.${p.institution.type}`)} />
            <Text style={{ fontSize: 18, fontWeight: "700", color: C.ink, marginTop: 6 }}>{p.title}{p.code ? `  ·  ${p.code}` : ""}</Text>
            <Pressable accessibilityRole="link" onPress={() => router.push(`/school/${p.institution.id}`)}><Text style={{ color: C.link, fontSize: 16, paddingVertical: 4, textDecorationLine: "underline" }}>{p.institution.name}{p.institution.district ? ` · ${p.institution.district}` : ""}</Text></Pressable>
            <ProgramFacts p={p} />
            <P muted>{t("fam.totalFee")}: <Text style={{ fontWeight: "700", color: C.ink }}>{mk(p.totalDueMinor)}</Text> · {left > 0 ? t("fam.seatsLeft", { n: left }) : t("fam.full")}{p.closesAt ? ` · ${t("fam.closesOn", { date: dt(p.closesAt) })}` : ""}</P>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Btn kind="ghost" label={t("fam.viewSchool")} onPress={() => router.push(`/school/${p.institution.id}`)} />
              {left > 0 ? <Btn testID={`apply-${p.code ?? p.id}`} label={t("fam.apply")} onPress={() => router.push(`/start/${p.id}`)} /> : null}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
