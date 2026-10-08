import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { patch, post } from "../src/api";
import { useT } from "../src/i18n";
import { kv } from "../src/kv";
import { useSession } from "../src/session";
import { Btn, Card, Field, LinkBtn, Msg, P, Screen, useBusy } from "../src/ui";

// Signup sends a code to the phone by WhatsApp (or SMS). Nothing that creates records or takes payments works until it is verified.
export default function Verify() {
  const { t } = useT();
  const { user, reload, signOut } = useSession();
  const router = useRouter();
  const { busy, msg, run } = useBusy();
  const [code, setCode] = useState(""), [dev, setDev] = useState(""), [via, setVia] = useState(""), [edit, setEdit] = useState(false), [phone, setPhone] = useState("");
  useEffect(() => { kv.get<{ devCode: string; channel: string }>("otp").then((o) => { if (o) { setDev(o.devCode); setVia(o.channel); } }); }, []);
  if (!user) return <Redirect href="/login" />;
  if (user.phoneVerified) return <Redirect href="/" />;
  const sent = (r: any) => { setDev(r?.devCode ?? ""); setVia(r?.channel ?? ""); kv.set("otp", { devCode: r?.devCode ?? "", channel: r?.channel ?? "" }); };
  return (
    <Screen>
      <Card>
        <P>{t("auth.verifyIntro", { phone: user.phone ?? "" })}</P>
        {via ? <P muted>{t("auth.sentVia", { channel: t(`auth.ch.${via}`) })}</P> : null}
        {dev ? <Msg kind="warn">{t("auth.devCode", { code: dev })}</Msg> : null}
        <Field testID="code" label={t("auth.code")} value={code} onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" />
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
        <Btn testID="submit" label={t("auth.verify")} busy={busy} disabled={code.length !== 6} onPress={async () => { if (await run(() => post("/auth/phone/verify", { code }))) { await kv.del("otp"); await reload(); router.replace("/"); } }} />
        <Btn kind="ghost" testID="resend" label={t("auth.resend")} busy={busy} onPress={() => run(async () => sent(await post("/auth/phone/send")))} />
        <LinkBtn label={t("auth.wrongNumber")} onPress={() => setEdit(!edit)} />
        {edit && <>
          <Field testID="newphone" label={t("auth.correctPhone")} value={phone} onChange={setPhone} keyboardType="phone-pad" placeholder="0999 123 456" />
          <Btn label={t("auth.saveSend")} busy={busy} disabled={phone.length < 6} onPress={async () => { if (await run(async () => sent(await patch("/auth/phone", { phone })))) { setEdit(false); await reload(); } }} />
        </>}
        <LinkBtn label={t("auth.signOut")} onPress={signOut} />
      </Card>
    </Screen>
  );
}
