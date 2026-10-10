import { Link, Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { ApiError } from "../src/api";
import { API } from "../src/config";
import { useT } from "../src/i18n";
import { useSession } from "../src/session";
import { AuthFrame, Btn, C, Card, Field, H1, LinkBtn, Msg, useErr } from "../src/ui";

export default function Login() {
  const { t } = useT();
  const { user, signIn } = useSession();
  const router = useRouter();
  const err = useErr();
  const [id, setId] = useState(""), [pw, setPw] = useState(""), [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  if (user) return <Redirect href="/" />;
  const go = async () => {
    setBusy(true); setMsg("");
    try { await signIn("login", { identifier: id.trim(), password: pw, ...(code && { code: code.trim() }) }); router.replace("/"); }
    catch (e) {
      if (e instanceof ApiError && e.code === "mfa_required") { setNeedCode(true); setMsg(t("auth.mfaNeeded")); } else setMsg(e instanceof ApiError && e.status === 0 ? `${t("err.network")} (${API})` : err(e));
    } finally { setBusy(false); }
  };
  return (
    <AuthFrame>
      <Card>
        <H1>{t("auth.signIn")}</H1>
        <Field testID="identifier" label={t("auth.identifier")} value={id} onChange={setId} autoCapitalize="none" autoComplete="username" keyboardType="email-address" />
        <Field testID="password" label={t("common.password")} value={pw} onChange={setPw} secureTextEntry autoComplete="current-password" />
        {needCode && <Field testID="code" label={t("auth.mfaCodeOrRecovery")} value={code} onChange={setCode} autoCapitalize="none" autoComplete="one-time-code" />}
        <Msg kind="err">{msg}</Msg>
        <Btn testID="submit" label={t("auth.signIn")} busy={busy} disabled={!id || !pw} onPress={go} />
        <LinkBtn label={t("auth.forgot")} onPress={() => router.push("/forgot")} />
        <Text style={{ color: C.ink2, fontSize: 16 }}>{t("auth.noAccount")} </Text>
        <Link href="/signup" style={{ color: C.link, fontSize: 16, paddingVertical: 10, textDecorationLine: "underline" }}>{t("auth.signUp")}</Link>
      </Card>
    </AuthFrame>
  );
}
