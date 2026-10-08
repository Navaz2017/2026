import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Linking, Platform, Text } from "react-native";
import { api, del, post } from "../../src/api";
import { useT } from "../../src/i18n";
import { useResource } from "../../src/offline";
import { Badge, Btn, C, Card, Field, H2, Loading, Msg, P, Row, Screen, Select, mk, toneFor, useBusy } from "../../src/ui";

function PayForm({ a, info, onDone }: { a: any; info: any; onDone: () => void }) {
  const { t } = useT();
  const [provider, setProvider] = useState("AIRTEL_MONEY"), [reference, setReference] = useState(""), [phone, setPhone] = useState("");
  const { busy, msg, run } = useBusy();
  const [done, setDone] = useState(false);
  if (done) return <Msg kind="ok">{t("fam.afterPay")}</Msg>;
  return (
    <>
      <P>{t("fam.payHow", { amount: mk(a.totalDueMinor) })}</P>
      <Select label={t("fam.provider")} value={provider} onChange={setProvider} options={["AIRTEL_MONEY", "MPAMBA"].map((p): [string, string] => [p, t(`provider.${p}`)])} />
      <P muted>{t("fam.sendTo")}</P>
      <Text selectable style={{ fontSize: 26, fontWeight: "700", color: C.navy, marginBottom: 12 }}>{info?.[provider] ?? "—"}</Text>
      <Field testID="reference" label={t("fam.reference")} value={reference} onChange={setReference} autoCapitalize="characters" maxLength={30} />
      <Field testID="payerPhone" label={t("fam.payerPhone")} value={phone} onChange={setPhone} keyboardType="phone-pad" placeholder="0999 123 456" />
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Btn testID="paid" label={t("fam.iPaid")} busy={busy} disabled={reference.trim().length < 6 || phone.length < 6} onPress={() => run(async () => { await post(`/me/applications/${a.id}/payment`, { provider, reference: reference.trim(), payerPhone: phone.trim() }); setDone(true); onDone(); })} />
    </>
  );
}

const confirm = (text: string, yes: () => void) => {
  if (Platform.OS === "web") { if (window.confirm(text)) yes(); } else Alert.alert(text, undefined, [{ text: "✕" }, { text: "OK", onPress: yes }]);
};

export default function ApplicationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const router = useRouter();
  const app = useResource<any>(`/me/applications/${id}`);
  const list = useResource<any[]>("/me/applications");
  const info = useResource<any>("/public/payment-info");
  const { busy, msg, run } = useBusy();
  const a = list.data?.find((x) => x.id === id) ?? app.data;
  return (
    <Screen>
      <Loading error={app.error && !a ? app.error : null} loading={(app.loading || list.loading) && !a} />
      {a && <Card>
        <Badge label={t(`st.app.${a.status}`)} tone={toneFor(a.status)} />
        <Text style={{ fontSize: 20, fontWeight: "700", color: C.ink, marginTop: 8 }}>{a.program?.title ?? a.choices?.[0]?.program?.title}</Text>
        <P muted>{a.program?.institution?.name ?? a.institution?.name}</P>
        <Row k={t("fam.fee")} v={mk(a.feeMinor)} /><Row k={t("fam.serviceFee")} v={mk(a.studentServiceFeeMinor)} /><Row k={t("fam.totalToPay")} v={mk(a.totalDueMinor)} />
        {a.decisionNote ? <P muted>“{a.decisionNote}”</P> : null}
      </Card>}
      {a?.status === "AWAITING_PAYMENT" && <Card title={t("fam.payTitle")}><PayForm a={a} info={info.data} onDone={() => { app.reload(); list.reload(); }} /></Card>}
      {a?.status === "PAYMENT_SUBMITTED" && <Msg kind="info">{t("fam.afterPay")}</Msg>}
      {a?.letter && <Btn label={t("fam.letter")} busy={busy} onPress={() => run(async () => { const l = await api(`/me/applications/${id}/letter`); await Linking.openURL(l.url); })} />}
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {a && (a.status === "AWAITING_PAYMENT" || a.status === "DRAFT") && <Btn kind="ghost" label={t("fam.withdraw")} busy={busy} onPress={() => confirm(t("fam.withdraw") + "?", () => run(async () => { await del(`/me/applications/${id}`); router.replace("/applications"); }))} />}
    </Screen>
  );
}
