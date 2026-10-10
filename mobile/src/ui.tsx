import React, { createElement, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError } from "./api";
import { API } from "./config";
import { LANGS, useT } from "./i18n";
import { useOnline } from "./net";
import { usePendingCount } from "./offline";

// Corporate palette shared with the website.
export const C = { navy: "#0b2545", navy2: "#13315c", gold: "#c9a227", bg: "#f4f5f7", card: "#ffffff", ink: "#18202c", ink2: "#4b5565", line: "#d8dde5", link: "#1d4e89", good: "#1b6b43", goodBg: "#e7f3ec", bad: "#9b1c1c", badBg: "#fbeaea", wait: "#7a5200", waitBg: "#fdf2d9", infoBg: "#e8eef7" };
export const serif = "Georgia";

export const mk = (minor: number | null | undefined) => `MK ${((minor ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const dt = (s?: string | null) => (s ? String(s).slice(0, 10) : "");

export function useErr() {
  const { t } = useT();
  return (e: unknown) => {
    const code = e instanceof ApiError ? e.code : "internal";
    if (code === "validation") return t("err.validation");
    const m = t(`err.${code}`);
    return m === `err.${code}` ? t("err.internal") : m;
  };
}

export function useBusy() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn" | "info"; text: string } | null>(null);
  const err = useErr();
  const run = async (fn: () => Promise<unknown>, okText?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (okText) setMsg({ kind: "ok", text: okText }); return true; }
    catch (e) { setMsg({ kind: "err", text: err(e) }); return false; }
    finally { setBusy(false); }
  };
  return { busy, msg, run, setMsg };
}

export function Screen({ children, scroll = true, pad = true }: { children: React.ReactNode; scroll?: boolean; pad?: boolean }) {
  const online = useOnline(), pending = usePendingCount();
  const { t } = useT();
  const body = scroll
    ? <ScrollView contentContainerStyle={[pad && { padding: 16, paddingBottom: 48 }]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    : <View style={[{ flex: 1 }, pad && { padding: 16 }]}>{children}</View>;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {(!online || pending > 0) && (
        <View style={s.banner} accessibilityRole="alert">
          <Text style={s.bannerText}>{!online ? t("common.offline") : ""}{!online && pending > 0 ? "  ·  " : ""}{pending > 0 ? t("m.pending", { n: pending }) : ""}</Text>
        </View>
      )}
      {body}
    </View>
  );
}

export const H1 = ({ children }: { children: React.ReactNode }) => <Text style={s.h1} accessibilityRole="header">{children}</Text>;
export const H2 = ({ children }: { children: React.ReactNode }) => <Text style={s.h2} accessibilityRole="header">{children}</Text>;
export const P = ({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: any }) => <Text style={[s.p, muted && { color: C.ink2 }, style]}>{children}</Text>;

export function Card({ title, children, style }: { title?: string; children?: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{title ? <H2>{title}</H2> : null}{children}</View>;
}

export function Btn({ label, onPress, kind = "primary", busy, disabled, testID }: { label: string; onPress: () => void; kind?: "primary" | "ghost" | "danger"; busy?: boolean; disabled?: boolean; testID?: string }) {
  const off = busy || disabled;
  const bg = kind === "primary" ? C.navy : kind === "danger" ? C.bad : "transparent";
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!off, busy: !!busy }} disabled={off} onPress={onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: kind === "ghost" ? C.line : bg, opacity: off ? 0.5 : pressed ? 0.85 : 1 }]}>
      {busy ? <ActivityIndicator color={kind === "ghost" ? C.navy : "#fff"} /> : <Text style={[s.btnText, kind === "ghost" && { color: C.navy }]}>{label}</Text>}
    </Pressable>
  );
}
export const LinkBtn = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <Pressable accessibilityRole="link" onPress={onPress} style={{ paddingVertical: 10, minHeight: 44, justifyContent: "center" }}><Text style={{ color: C.link, fontSize: 16, textDecorationLine: "underline" }}>{label}</Text></Pressable>
);

export function Msg({ kind, children }: { kind: "ok" | "err" | "warn" | "info"; children?: React.ReactNode }) {
  if (!children) return null;
  const c = { ok: [C.goodBg, C.good], err: [C.badBg, C.bad], warn: [C.waitBg, C.wait], info: [C.infoBg, C.navy2] }[kind]!;
  return <View style={[s.msg, { backgroundColor: c[0], borderLeftColor: c[1] }]} accessibilityRole={kind === "err" ? "alert" : undefined}><Text style={{ color: c[1], fontSize: 16, lineHeight: 22 }}>{children}</Text></View>;
}
export const Loading = ({ error, loading }: { error?: unknown; loading?: boolean }) => {
  const err = useErr();
  if (error) return <Msg kind="err">{err(error)}</Msg>;
  return loading ? <ActivityIndicator style={{ margin: 24 }} color={C.navy} accessibilityLabel="loading" /> : null;
};
export const Empty = () => { const { t } = useT(); return <Text style={[s.p, { color: C.ink2, textAlign: "center", marginVertical: 24 }]}>{t("common.none")}</Text>; };

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "good" | "bad" | "wait" }) {
  const c = { neutral: [C.infoBg, C.navy2], good: [C.goodBg, C.good], bad: [C.badBg, C.bad], wait: [C.waitBg, C.wait] }[tone]!;
  return <View style={{ alignSelf: "flex-start", backgroundColor: c[0], paddingHorizontal: 10, paddingVertical: 3, borderRadius: 4 }}><Text style={{ color: c[1], fontSize: 13, fontWeight: "600" }}>{label}</Text></View>;
}
export const toneFor = (st: string) => (st === "ACCEPTED" ? "good" : st === "REJECTED" || st === "WITHDRAWN" ? "bad" : st === "DRAFT" ? "neutral" : "wait") as "good" | "bad" | "wait" | "neutral";

export function Field({ label, hint, value, onChange, required, testID, ...rest }: { label: string; hint?: string; value: any; onChange: (v: string) => void; required?: boolean; testID?: string } & Omit<TextInputProps, "value" | "onChangeText" | "onChange">) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}{required ? " *" : ""}</Text>
      <TextInput testID={testID} accessibilityLabel={label} style={[s.input, rest.multiline && { minHeight: 96, textAlignVertical: "top" }]} value={value == null ? "" : String(value)} onChangeText={onChange} placeholderTextColor="#8a93a3" {...rest} />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

// A real date picker (value as YYYY-MM-DD): the phone's calendar on Android/iOS, the browser's own picker on the web build.
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function DateField({ label, value, onChange, required, hint, testID, max = new Date(), min, initial }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; hint?: string; testID?: string; max?: Date; min?: Date; initial?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const cur = value ? new Date(`${value}T12:00:00`) : new Date(`${initial ?? "2008-01-01"}T12:00:00`);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}{required ? " *" : ""}</Text>
      {Platform.OS === "web"
        ? createElement("input", { type: "date", value, "aria-label": label, "data-testid": testID, max: iso(max), min: min ? iso(min) : undefined, onChange: (e: any) => onChange(e.target.value), style: { minHeight: 48, border: "1px solid #aab3c2", borderRadius: 6, padding: "0 12px", fontSize: 17, color: C.ink, background: "#fff", boxSizing: "border-box", width: "100%" } })
        : (
          <>
            <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={() => {
              if (Platform.OS === "android") DateTimePickerAndroid.open({ value: cur, mode: "date", maximumDate: max, minimumDate: min, onChange: (_e, d) => { if (d) onChange(iso(d)); } });
              else setOpen(true);
            }} style={[s.input, { justifyContent: "center" }]}>
              <Text style={{ fontSize: 17, color: value ? C.ink : "#8a93a3" }}>{value || t("m.pickDate")}</Text>
            </Pressable>
            {Platform.OS === "ios" && (
              <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
                <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.4)" }}>
                  <SafeAreaView edges={["bottom"]} style={{ backgroundColor: C.card }}>
                    <DateTimePicker value={cur} mode="date" display="spinner" maximumDate={max} minimumDate={min} onChange={(_e, d) => { if (d) onChange(iso(d)); }} />
                    <Btn label={t("common.save")} onPress={() => { if (!value) onChange(iso(cur)); setOpen(false); }} />
                  </SafeAreaView>
                </View>
              </Modal>
            )}
          </>
        )}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

// Few options -> tappable chips (easy for everyone); many -> a pick-list sheet.
export function Select({ label, value, onChange, options, required, hint }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; required?: boolean; hint?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const cur = options.find(([k]) => k === value)?.[1];
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}{required ? " *" : ""}</Text>
      {options.length <= 4 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {options.map(([k, text]) => (
            <Pressable key={k} accessibilityRole="radio" accessibilityState={{ selected: k === value }} accessibilityLabel={text} onPress={() => onChange(k)} style={[s.chip, k === value && s.chipOn]}>
              <Text style={[s.chipText, k === value && { color: "#fff" }]}>{text}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <>
          <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} style={[s.input, { justifyContent: "center" }]}><Text style={{ fontSize: 17, color: cur ? C.ink : "#8a93a3" }}>{cur ?? "—"}</Text></Pressable>
          <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,.4)", justifyContent: "flex-end" }}>
              <SafeAreaView edges={["bottom"]} style={{ backgroundColor: C.card, maxHeight: "75%", borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
                <ScrollView>
                  {!required && <Pressable onPress={() => { onChange(""); setOpen(false); }} style={s.opt}><Text style={s.optText}>—</Text></Pressable>}
                  {options.map(([k, text]) => <Pressable key={k} accessibilityRole="menuitem" onPress={() => { onChange(k); setOpen(false); }} style={[s.opt, k === value && { backgroundColor: C.infoBg }]}><Text style={s.optText}>{text}</Text></Pressable>)}
                </ScrollView>
                <Btn kind="ghost" label={t("common.close")} onPress={() => setOpen(false)} />
              </SafeAreaView>
            </View>
          </Modal>
        </>
      )}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label} onPress={() => onChange(!checked)} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start", paddingVertical: 8, minHeight: 44 }}>
      <View style={[s.box, checked && { backgroundColor: C.navy, borderColor: C.navy }]}>{checked ? <Text style={{ color: "#fff", fontWeight: "700" }}>✓</Text> : null}</View>
      <Text style={[s.p, { flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

export function LanguagePicker({ value, onChange, dark }: { value: string; onChange: (l: any) => void; dark?: boolean }) {
  const { t } = useT();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
      {LANGS.map((l) => (
        <Pressable key={l} accessibilityRole="radio" accessibilityState={{ selected: l === value }} onPress={() => onChange(l)} style={{ paddingVertical: 10, paddingHorizontal: 12, minHeight: 44, justifyContent: "center", borderBottomWidth: 3, borderBottomColor: l === value ? C.gold : "transparent" }}>
          <Text style={{ color: dark ? (l === value ? "#fff" : "#c9d4e6") : l === value ? C.navy : C.ink2, fontSize: 16, fontWeight: l === value ? "700" : "400" }}>{t(`lang.${l}`)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function AuthFrame({ children }: { children: React.ReactNode }) {
  const { lang, setLang, t } = useT();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: C.navy, borderBottomWidth: 3, borderBottomColor: C.gold }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={{ color: "#fff", fontFamily: serif, fontSize: 28, fontWeight: "600" }}>{t("common.appName")}</Text>
          <LanguagePicker value={lang} onChange={setLang} dark />
        </View>
      </SafeAreaView>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {children}
        {__DEV__ && <Text selectable style={{ color: C.ink2, fontSize: 13, marginTop: 8 }}>Server: {API}</Text>}
      </ScrollView>
    </View>
  );
}

export const Row = ({ k, v }: { k: string; v: any }) => (v === undefined || v === null || v === "" ? null : (
  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 4 }}><Text style={[s.p, { color: C.ink2, flexShrink: 1 }]}>{k}</Text><Text style={[s.p, { flexShrink: 1, textAlign: "right" }]}>{v}</Text></View>
));

const s = StyleSheet.create({
  banner: { backgroundColor: C.wait, paddingVertical: 6, paddingHorizontal: 16 }, bannerText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  h1: { fontFamily: serif, fontSize: 26, fontWeight: "600", color: C.ink, marginBottom: 12 }, h2: { fontFamily: serif, fontSize: 19, fontWeight: "600", color: C.ink, marginBottom: 8 },
  p: { fontSize: 16, lineHeight: 23, color: C.ink },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 6, padding: 16, marginBottom: 14 },
  btn: { minHeight: 48, paddingHorizontal: 18, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center", marginVertical: 4 }, btnText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  msg: { borderLeftWidth: 4, padding: 12, borderRadius: 4, marginVertical: 8 },
  label: { fontSize: 15, fontWeight: "600", color: C.ink, marginBottom: 6 }, hint: { fontSize: 14, color: C.ink2, marginTop: 4 },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#aab3c2", borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, fontSize: 17, color: C.ink, backgroundColor: "#fff" },
  chip: { minHeight: 44, paddingHorizontal: 16, justifyContent: "center", borderWidth: 1, borderColor: "#aab3c2", borderRadius: 22, backgroundColor: "#fff" }, chipOn: { backgroundColor: C.navy, borderColor: C.navy }, chipText: { fontSize: 16, color: C.ink },
  opt: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.line }, optText: { fontSize: 17, color: C.ink },
  box: { width: 26, height: 26, borderWidth: 2, borderColor: "#aab3c2", borderRadius: 4, alignItems: "center", justifyContent: "center", marginTop: 1 },
});
