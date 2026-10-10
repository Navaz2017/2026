import { Link, Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { ApiError } from "../src/api";
import { API } from "../src/config";
import { useT } from "../src/i18n";
import { kv } from "../src/kv";
import { useSession } from "../src/session";
import { AuthFrame, Btn, Card, Check, Field, H1, Msg, Select, useErr } from "../src/ui";

// Parents and students sign up here. Schools and the platform owner use the website.
export default function Signup() {
  const { t, lang } = useT();
  const { user, signIn } = useSession();
  const router = useRouter();
  const err = useErr();
  const [role, setRole] = useState("PARENT");
  const [f, setF] = useState({ fullName: "", phone: "", email: "", occupation: "", password: "" });
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  if (user) return <Redirect href="/" />;
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const ok = f.fullName.length > 1 && f.phone.length > 5 && f.password.length >= 10 && consent && (role === "STUDENT" || f.occupation.length > 1);
  const go = async () => {
    setBusy(true); setMsg("");
    try {
      const d = await signIn("signup", { role, language: lang, consent: true, fullName: f.fullName.trim(), phone: f.phone.trim(), password: f.password, ...(f.email && { email: f.email.trim() }), ...(role === "PARENT" && { occupation: f.occupation.trim() }) });
      await kv.set("otp", { devCode: d?.verification?.devCode ?? "", channel: d?.verification?.channel ?? "" });
      router.replace("/verify");
    } catch (e) { setMsg(e instanceof ApiError && e.status === 0 ? `${t("err.network")} (${API})` : err(e)); } finally { setBusy(false); }
  };
  return (
    <AuthFrame>
      <Card>
        <H1>{t("auth.signUp")}</H1>
        <Select label={t("auth.iAm")} value={role} onChange={setRole} options={[["PARENT", t("auth.rParent")], ["STUDENT", t("auth.rStudent")]]} />
        <Field testID="fullName" label={t("auth.fullName")} value={f.fullName} onChange={set("fullName")} required autoComplete="name" />
        <Field testID="phone" label={t("common.phone")} hint={t("auth.phoneHelp")} value={f.phone} onChange={set("phone")} required keyboardType="phone-pad" autoComplete="tel" placeholder="0999 123 456" />
        <Field testID="email" label={t("auth.emailOptional")} value={f.email} onChange={set("email")} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        {role === "PARENT" && <Field testID="occupation" label={t("auth.occupation")} value={f.occupation} onChange={set("occupation")} required />}
        <Field testID="newpw" label={t("common.password")} hint={t("auth.passwordHelp")} value={f.password} onChange={set("password")} required secureTextEntry autoComplete="new-password" />
        <Check label={t(role === "PARENT" ? "auth.consent" : "auth.consentStudent")} checked={consent} onChange={setConsent} />
        <Msg kind="err">{msg}</Msg>
        <Btn testID="submit" label={t("auth.signUp")} busy={busy} disabled={!ok} onPress={go} />
        <Link href="/login" style={{ paddingVertical: 12, fontSize: 16, textDecorationLine: "underline" }}>{t("auth.haveAccount")} {t("auth.signIn")}</Link>
      </Card>
    </AuthFrame>
  );
}
