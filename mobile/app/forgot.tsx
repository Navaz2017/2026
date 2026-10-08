import { useRouter } from "expo-router";
import { useState } from "react";
import { post } from "../src/api";
import { useT } from "../src/i18n";
import { AuthFrame, Btn, Card, Field, H1, LinkBtn, Msg, P, useBusy } from "../src/ui";

// A phone number gets a code (WhatsApp/SMS); an email address gets a link, as on the website.
export default function Forgot() {
  const { t } = useT();
  const router = useRouter();
  const { busy, msg, run } = useBusy();
  const [id, setId] = useState(""), [code, setCode] = useState(""), [pw, setPw] = useState("");
  const [step, setStep] = useState<"ask" | "code" | "done">("ask"), [dev, setDev] = useState("");
  const byPhone = !id.includes("@");
  return (
    <AuthFrame>
      <Card>
        <H1>{t("auth.forgot")}</H1>
        {step === "done" ? <><Msg kind="ok">{t("auth.passwordChanged")}</Msg><Btn label={t("auth.signIn")} onPress={() => router.replace("/login")} /></> : <>
          <Field testID="identifier" label={t("auth.identifier")} value={id} onChange={setId} autoCapitalize="none" editable={step === "ask"} />
          {step === "code" && <>
            <Msg kind="ok">{t("auth.linkSent")}</Msg>
            {dev ? <Msg kind="warn">{t("auth.devCode", { code: dev })}</Msg> : null}
            <P muted>{t("auth.resetByPhoneHelp")}</P>
            <Field testID="code" label={t("auth.code")} value={code} onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" />
            <Field testID="newpw" label={t("auth.newPassword")} hint={t("auth.passwordHelp")} value={pw} onChange={setPw} secureTextEntry />
          </>}
          {msg && !(step === "code" && msg.kind === "ok") && <Msg kind={msg.kind}>{msg.text}</Msg>}
          <Btn testID="submit" busy={busy} disabled={!id || (step === "code" && (code.length !== 6 || pw.length < 10))} label={step === "code" ? t("auth.setPassword") : t("auth.sendReset")} onPress={async () => {
            if (step === "ask") { let d = ""; const ok = await run(async () => { d = (await post("/auth/forgot", { identifier: id.trim() }))?.devCode ?? ""; }, byPhone ? undefined : t("auth.linkSent")); if (ok && byPhone) { setDev(d); setStep("code"); } }
            else if (await run(() => post("/auth/reset-phone", { phone: id.trim(), code, password: pw }))) setStep("done");
          }} />
          <LinkBtn label={t("auth.signIn")} onPress={() => router.replace("/login")} />
        </>}
      </Card>
    </AuthFrame>
  );
}
