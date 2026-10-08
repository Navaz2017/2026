import React, { useState } from "react";
import { Image, Linking, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useT } from "./i18n";
import { Badge, Btn, C, Card, H1, P, Row, mk, dt } from "./ui";

export const isSchool = (type: string) => type === "PRIMARY_SCHOOL" || type === "SECONDARY_SCHOOL";
export const levelLabel = (l: string) => (l.startsWith("STD") ? `Standard ${l.slice(3)}` : `Form ${l.slice(1)}`);

export function ProgramFacts({ p }: { p: any }) {
  const { t } = useT();
  return (
    <View>
      <P muted><Text style={{ fontWeight: "700" }}>{t("prog.tuition")}: </Text>{p.tuitionFeeMinor > 0 ? `${mk(p.tuitionFeeMinor)} ${t(`period.${p.tuitionPeriod}`)}` : "—"}{p.duration ? ` · ${t("prog.duration")}: ${p.duration}` : ""}</P>
      {p.modes?.length > 0 && <P muted>{t("prog.modes")}: {p.modes.map((m: string) => t(`mode.${m}`)).join(", ")}</P>}
      {p.entryRequirements ? <P muted>{t("prog.entry")}: {p.entryRequirements}</P> : null}
    </View>
  );
}

// Photos open full-screen; videos open in the phone's own player/browser.
export function Gallery({ items }: { items: { id: string; kind: string; caption?: string | null; url: string }[] }) {
  const { t } = useT();
  const [open, setOpen] = useState<number | null>(null);
  const cur = open === null ? null : items[open];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {items.map((m, i) => (
        <Pressable key={m.id} accessibilityRole="imagebutton" accessibilityLabel={`${t("media.preview")}: ${m.caption ?? ""}`} onPress={() => (m.kind === "VIDEO" ? Linking.openURL(m.url) : setOpen(i))} style={{ width: 104, height: 104, backgroundColor: C.infoBg, borderRadius: 4, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
          {m.kind === "VIDEO" ? <Text style={{ fontSize: 34, color: C.navy }}>▶</Text> : <Image source={{ uri: m.url }} style={{ width: 104, height: 104 }} resizeMode="cover" accessibilityLabel={m.caption ?? ""} />}
        </Pressable>
      ))}
      <Modal visible={!!cur} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: "rgba(0,0,0,.92)", justifyContent: "center" }}>
          {cur && <Image source={{ uri: cur.url }} style={{ width: "100%", height: "70%" }} resizeMode="contain" accessibilityLabel={cur.caption ?? ""} />}
          {cur?.caption ? <Text style={{ color: "#fff", textAlign: "center", fontSize: 16, padding: 12 }}>{cur.caption}</Text> : null}
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, padding: 12 }}>
            <Btn kind="ghost" label="‹" onPress={() => setOpen((i) => (i === null ? i : (i - 1 + items.length) % items.length))} />
            <Btn kind="ghost" label={t("media.close")} onPress={() => setOpen(null)} />
            <Btn kind="ghost" label="›" onPress={() => setOpen((i) => (i === null ? i : (i + 1) % items.length))} />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

export function SchoolView({ s, onApply }: { s: any; onApply: (programId: string) => void }) {
  const { t } = useT();
  const school = isSchool(s.type);
  return (
    <View>
      <Badge label={t(`type.${s.type}`)} />
      <H1>{s.name}</H1>
      <P muted>{[s.district, s.address].filter(Boolean).join(" · ")}</P>
      {s.description ? <Card title={t("sch.about")}><P>{s.description}</P></Card> : null}
      <Card>
        {school && s.highestLevel ? <Row k={t("sch.highest")} v={`${levelLabel(s.highestLevel)}${s.syllabi?.length ? ` · ${s.syllabi.join(" / ")}` : ""}`} /> : null}
        {s.campuses?.length > 0 ? <Row k={t("sch.campuses")} v={s.campuses.join(", ")} /> : null}
        {s.website ? <Pressable accessibilityRole="link" onPress={() => Linking.openURL(s.website)}><Row k={t("sch.website")} v={s.website} /></Pressable> : null}
        <Row k={t("auth.contactEmail")} v={[s.contactPhone, s.contactEmail].filter(Boolean).join(" · ")} />
      </Card>
      <Card title={school ? t("sch.classes") : t("sch.programmes")}>
        {s.programs.length === 0 && <P muted>{t("common.none")}</P>}
        {s.programs.map((p: any) => {
          const left = Math.max(0, p.seats - p.seatsTaken);
          return (
            <View key={p.id} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 10 }}>
              <P style={{ fontWeight: "700" }}>{p.title}{p.code ? `  ·  ${p.code}` : ""}</P>
              <ProgramFacts p={p} />
              <P muted>{t("fam.totalFee")}: <Text style={{ fontWeight: "700", color: C.ink }}>{mk(p.totalDueMinor)}</Text> · {t("fam.seatsLeft", { n: left })}{p.closesAt ? ` · ${t("fam.closesOn", { date: dt(p.closesAt) })}` : ""}</P>
              {left > 0 ? <Btn testID={`apply-${p.code ?? p.title}`} label={t("fam.apply")} onPress={() => onApply(p.id)} /> : <Btn label={t("fam.full")} disabled onPress={() => {}} />}
            </View>
          );
        })}
      </Card>
      {Array.isArray(s.otherFees) && s.otherFees.length > 0 && <Card title={t("sch.otherFees")}>{s.otherFees.map((f: any, i: number) => <Row key={i} k={f.name} v={`${mk(f.amountMinor)} ${t(`period.${f.period}`)}`} />)}</Card>}
      <Card title={t("sch.gallery")}>{s.media.length === 0 ? <P muted>{t("sch.noMedia")}</P> : <Gallery items={s.media} />}</Card>
    </View>
  );
}
