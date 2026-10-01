"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { post } from "@/lib/api";
import { LanguageSwitcher, useT } from "@/lib/i18n";
import { Btn, Field, Msg, useBusy } from "@/lib/ui";

function Form() {
  const { t } = useT();
  const token = useSearchParams().get("token") ?? "";
  const { busy, msg, run } = useBusy();
  const [pw, setPw] = useState(""), [done, setDone] = useState(false);
  return (
    <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await run(() => post("/auth/reset", { token, password: pw }))) setDone(true); }}>
      <h1>{t("auth.setPassword")}</h1>
      {done ? <><Msg kind="ok">{t("auth.passwordChanged")}</Msg><Link href="/">{t("auth.signIn")}</Link></> : <>
        <Field label={t("auth.newPassword")} hint={t("auth.passwordHelp")}><input type="password" required minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
        <Btn busy={busy} style={{ width: "100%" }}>{t("auth.setPassword")}</Btn>
      </>}
    </form>
  );
}
export default function Reset() {
  const { t } = useT();
  return <main className="authwrap"><div className="top"><span className="logo">{t("common.appName")}</span><LanguageSwitcher /></div><Suspense><Form /></Suspense></main>;
}
