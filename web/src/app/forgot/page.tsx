"use client";
import Link from "next/link";
import { useState } from "react";
import { post } from "@/lib/api";
import { LanguageSwitcher, useT } from "@/lib/i18n";
import { Btn, Field, Msg, useBusy } from "@/lib/ui";

export default function Forgot() {
  const { t } = useT();
  const { busy, msg, run } = useBusy();
  const [email, setEmail] = useState("");
  return (
    <main className="authwrap">
      <div className="top"><span className="logo">{t("common.appName")}</span><LanguageSwitcher /></div>
      <form className="card" onSubmit={(e) => { e.preventDefault(); run(() => post("/auth/forgot", { email }), t("auth.linkSent")); }}>
        <h1>{t("auth.forgot")}</h1>
        <Field label={t("common.email")}><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
        <Btn busy={busy} style={{ width: "100%" }}>{t("auth.sendLink")}</Btn>
        <p><Link href="/">{t("auth.signIn")}</Link></p>
      </form>
    </main>
  );
}
