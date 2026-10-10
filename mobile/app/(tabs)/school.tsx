import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { post } from "../../src/api";
import { useT } from "../../src/i18n";
import { useResource } from "../../src/offline";
import { Btn, C, Card, Empty, H2, Loading, P, Screen, Select, dt } from "../../src/ui";

const TABS = ["progress", "attendance", "notices"] as const;

export default function School() {
  const { t } = useT();
  const kids = useResource<any[]>("/me/school/children");
  const [sel, setSel] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]>("progress");
  const options: [string, string][] = (kids.data ?? []).flatMap((k) => k.enrolments.map((e: any) => [`${k.id}|${e.institution.id}`, `${k.fullName} — ${e.institution.name}${e.class ? ` (${e.class.name})` : ""}`] as [string, string]));
  useEffect(() => { if (!sel && options[0]) setSel(options[0][0]); }, [kids.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sid, inst] = sel.split("|");
  const d = useResource<any>(sid ? `/me/school/children/${sid}/${tab === "notices" ? "announcements" : tab}?institutionId=${inst}` : null);
  const data = d.data;
  return (
    <Screen>
      <Loading error={kids.error} loading={kids.loading && !kids.data} />
      {kids.data && options.length === 0 && <><Empty /><P muted>{t("sh.notLinked")}</P></>}
      {options.length > 0 && <>
        <Select label={t("nav.mySchool")} value={sel} onChange={setSel} options={options} />
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
          {TABS.map((x) => <View key={x} style={{ flex: 1 }}><Btn label={t(`sh.tab.${x}`)} kind={x === tab ? "primary" : "ghost"} onPress={() => setTab(x)} /></View>)}
        </View>
        <Loading error={d.error} loading={d.loading && !d.data} />
        {tab === "progress" && data?.subjects && <>
          {data.overallAverage != null && <H2>{t("sh.overall")}: {data.overallAverage}%</H2>}
          {data.subjects.length === 0 && <Empty />}
          {data.subjects.map((s: any) => (
            <Card key={s.subject} title={`${s.subject}${s.average != null ? ` — ${s.average}%${s.grade ? ` (${s.grade})` : ""}` : ""}`}>
              {s.items.map((i: any) => (
                <View key={i.id} style={{ marginBottom: 8 }}>
                  <Text style={{ fontSize: 16, color: C.ink }}>{i.title} · {i.score ?? "—"}/{i.maxScore}{i.grade ? ` · ${i.grade}` : ""}</Text>
                  {i.feedback ? <P muted>“{i.feedback}”</P> : null}
                </View>
              ))}
            </Card>
          ))}
        </>}
        {tab === "attendance" && data?.summary && <Card>
          <H2>{data.summary.rate ?? "—"}%</H2>
          <P>{t("sh.att.PRESENT")} {data.summary.present} · {t("sh.att.ABSENT")} {data.summary.absent} · {t("sh.att.LATE")} {data.summary.late} · {t("sh.att.EXCUSED")} {data.summary.excused}</P>
          {data.records.filter((r: any) => r.status !== "PRESENT").map((r: any) => <P key={r.date} muted>{dt(r.date)} · {t(`sh.att.${r.status}`)}{r.note ? ` · ${r.note}` : ""}</P>)}
        </Card>}
        {tab === "notices" && Array.isArray(data) && <>
          {data.length === 0 && <Empty />}
          {data.map((a: any) => (
            <Card key={a.id} title={`${a.urgent ? "⚠ " : ""}${a.title}`}>
              <P>{a.body}</P><P muted>{dt(a.createdAt)}</P>
              {!a.read && <Btn kind="ghost" label={t("sh.markRead")} onPress={() => { post(`/me/school/announcements/${a.id}/read`).then(() => d.reload?.()).catch(() => {}); }} />}
            </Card>
          ))}
        </>}
      </>}
    </Screen>
  );
}
