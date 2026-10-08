"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, patch, post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { homeFor, useSession } from "@/lib/session";
import { Btn, Card, Field, Msg, Page, useBusy } from "@/lib/ui";

export default function Verify() {
  const { t } = useT();
  const { user, reload } = useSession();
  const router = useRouter();
  const { busy, msg, run, setMsg } = useBusy();
  const [code, setCode] = useState(""), [dev, setDev] = useState(""), [sentVia, setSentVia] = useState(""), [edit, setEdit] = useState(false), [phone, setPhone] = useState("");

  useEffect(() => { if (user?.phoneVerified) router.replace(homeFor(user.role)); }, [user, router]);
  useEffect(() => { // the code that signup already sent
    try { setDev(sessionStorage.getItem("devCode") ?? ""); setSentVia(sessionStorage.getItem("otpChannel") ?? ""); } catch {}
  }, []);
  const sent = (r: any) => { setDev(r?.devCode ?? ""); setSentVia(r?.channel ?? ""); try { sessionStorage.setItem("devCode", r?.devCode ?? ""); sessionStorage.setItem("otpChannel", r?.channel ?? ""); } catch {} };
  if (!user) return null;

  return (
    <Page title={t("auth.verifyTitle")}>
      <Card>
        <p>{t("auth.verifyIntro", { phone: user.phone ?? "" })}</p>
        {sentVia && <p className="muted">{t("auth.sentVia", { channel: t(`auth.ch.${sentVia}`) })}</p>}
        {dev && <Msg kind="warn">{t("auth.devCode", { code: dev })}</Msg>}
        <form onSubmit={async (e) => { e.preventDefault(); if (await run(() => post("/auth/phone/verify", { code }))) { try { sessionStorage.removeItem("devCode"); } catch {} await reload(); } }}>
          <Field label={t("auth.code")}><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required autoFocus style={{ letterSpacing: ".3em", fontSize: "1.4rem" }} /></Field>
          {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
          <Btn busy={busy}>{t("auth.verify")}</Btn>
        </form>
        <div className="row" style={{ marginTop: "1rem" }}>
          <Btn kind="ghost" busy={busy} onClick={() => run(async () => sent(await post("/auth/phone/send")))}>{t("auth.resend")}</Btn>
          <Btn kind="ghost" onClick={() => setEdit(!edit)}>{t("auth.wrongNumber")}</Btn>
        </div>
        {edit && <form onSubmit={async (e) => { e.preventDefault(); if (await run(async () => sent(await patch("/auth/phone", { phone })))) { setEdit(false); await reload(); } }}>
          <Field label={t("auth.correctPhone")}><input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0999 123 456" /></Field>
          <Btn busy={busy}>{t("auth.saveSend")}</Btn>
        </form>}
      </Card>
    </Page>
  );
}
