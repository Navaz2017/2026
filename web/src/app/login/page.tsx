"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthLayout } from "@/components/AuthLayout";
import { useT } from "@/lib/i18n";
import { homeFor, useSession } from "@/lib/session";
import { Btn, Field, Msg } from "@/lib/ui";

export default function Login() {
  const { t } = useT();
  const { user, signIn } = useSession();
  const router = useRouter();
  const [needCode, setNeedCode] = useState(false);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { if (user) router.replace(homeFor(user.role)); }, [user, router]);

  return (
    <AuthLayout>
      <form className="card" onSubmit={async (e) => {
        e.preventDefault(); setErr(""); setBusy(true);
        const f = new FormData(e.currentTarget);
        try { await signIn("login", { email: f.get("email"), password: f.get("password"), ...(f.get("code") && { code: f.get("code") }) }); }
        catch (x: any) {
          if (x.code === "mfa_required") { setNeedCode(true); setErr(t("auth.mfaNeeded")); }
          else setErr(t(`err.${x.code}`) === `err.${x.code}` ? t("err.internal") : t(`err.${x.code}`));
        } finally { setBusy(false); }
      }}>
        <h1>{t("auth.signIn")}</h1>
        <Field label={t("common.email")}><input name="email" type="email" required autoComplete="username" inputMode="email" /></Field>
        <Field label={t("common.password")}><input name="password" type="password" required autoComplete="current-password" /></Field>
        {needCode && <Field label={t("auth.mfaCode")}><input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required autoFocus /></Field>}
        <Msg kind="err">{err}</Msg>
        <Btn kind="primary" busy={busy} style={{ width: "100%" }}>{t("auth.signIn")}</Btn>
        <p><Link href="/forgot">{t("auth.forgot")}</Link></p>
        <p style={{ marginBottom: 0 }}>{t("auth.noAccount")} <Link href="/signup">{t("auth.signUp")}</Link></p>
      </form>
    </AuthLayout>
  );
}
