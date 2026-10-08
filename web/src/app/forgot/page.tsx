"use client";
import Link from "next/link";
import { useState } from "react";
import { post } from "@/lib/api";
import { AuthLayout } from "@/components/AuthLayout";
import { useT } from "@/lib/i18n";
import { Btn, Field, Msg, useBusy } from "@/lib/ui";

// An email address gets a reset link; a phone number gets a code that is entered right here.
export default function Forgot() {
  const { t } = useT();
  const { busy, msg, run } = useBusy();
  const [id, setId] = useState(""), [code, setCode] = useState(""), [pw, setPw] = useState("");
  const [step, setStep] = useState<"ask" | "code" | "done">("ask");
  const [dev, setDev] = useState("");
  const byPhone = !id.includes("@");
  return (
    <AuthLayout>
      <form className="card" onSubmit={async (e) => {
        e.preventDefault();
        if (step === "ask") {
          let devCode = "";
          const ok = await run(async () => { devCode = ((await post<any>("/auth/forgot", { identifier: id })) as any)?.devCode ?? ""; }, byPhone ? undefined : t("auth.linkSent"));
          if (ok && byPhone) { setDev(devCode); setStep("code"); }
        } else if (step === "code") {
          if (await run(() => post("/auth/reset-phone", { phone: id, code, password: pw }))) setStep("done");
        }
      }}>
        <h1>{t("auth.forgot")}</h1>
        {step === "done" ? <><Msg kind="ok">{t("auth.passwordChanged")}</Msg><Link href="/login">{t("auth.signIn")}</Link></> : <>
          <Field label={t("auth.identifier")}><input required value={id} onChange={(e) => setId(e.target.value)} disabled={step === "code"} autoCapitalize="none" autoComplete="username" /></Field>
          {step === "code" && <>
            <Msg kind="ok">{t("auth.linkSent")}</Msg>
            {dev && <Msg kind="warn">{t("auth.devCode", { code: dev })}</Msg>}
            <p className="muted">{t("auth.resetByPhoneHelp")}</p>
            <Field label={t("auth.code")}><input required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" /></Field>
            <Field label={t("auth.newPassword")} hint={t("auth.passwordHelp")}><input type="password" required minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
          </>}
          {msg && !(step === "code" && msg.kind === "ok") && <Msg kind={msg.kind}>{msg.text}</Msg>}
          <Btn busy={busy} style={{ width: "100%" }}>{step === "code" ? t("auth.setPassword") : t("auth.sendReset")}</Btn>
          <p><Link href="/login">{t("auth.signIn")}</Link></p>
        </>}
      </form>
    </AuthLayout>
  );
}
