"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthLayout } from "@/components/AuthLayout";
import { useT } from "@/lib/i18n";
import { homeFor, useSession } from "@/lib/session";
import { Btn, Field, Msg } from "@/lib/ui";

type R = "PARENT" | "STUDENT" | "INSTITUTION_ADMIN";
export default function Signup() {
  const { t, lang } = useT();
  const { user, signIn } = useSession();
  const router = useRouter();
  const [role, setRole] = useState<R>("PARENT");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { if (user) router.replace(homeFor(user.role)); }, [user, router]);

  return (
    <AuthLayout>
      <form className="card" onSubmit={async (e) => {
        e.preventDefault(); setErr(""); setBusy(true);
        const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        const body: any = { role, language: lang, consent: f.consent === "on", email: f.email, password: f.password, fullName: f.fullName, ...(f.phone && { phone: f.phone }) };
        if (role === "PARENT") Object.assign(body, { occupation: f.occupation, employer: f.employer || undefined });
        if (role === "INSTITUTION_ADMIN") body.institution = { name: f.instName, type: f.instType, district: f.district || undefined, contactEmail: f.contactEmail };
        try { await signIn("signup", body); }
        catch (x: any) { setErr(x.code === "validation" ? t("err.validation") : t(`err.${x.code}`) === `err.${x.code}` ? t("err.internal") : t(`err.${x.code}`)); }
        finally { setBusy(false); }
      }}>
        <h1>{t("auth.signUp")}</h1>
        <Field label={t("auth.iAm")}>
          <select value={role} onChange={(e) => setRole(e.target.value as R)}>
            <option value="PARENT">{t("auth.rParent")}</option><option value="STUDENT">{t("auth.rStudent")}</option><option value="INSTITUTION_ADMIN">{t("auth.rInstitution")}</option>
          </select>
        </Field>
        <Field label={t("auth.fullName")}><input name="fullName" required minLength={2} autoComplete="name" /></Field>
        <Field label={t("common.email")}><input name="email" type="email" required autoComplete="email" /></Field>
        <Field label={t("common.phone")}><input name="phone" type="tel" inputMode="tel" placeholder="0999 123 456" autoComplete="tel" /></Field>
        {role === "PARENT" && <>
          <Field label={t("auth.occupation")}><input name="occupation" required minLength={2} /></Field>
          <Field label={t("auth.employer")}><input name="employer" /></Field>
        </>}
        {role === "INSTITUTION_ADMIN" && <>
          <Field label={t("auth.instName")}><input name="instName" required minLength={2} /></Field>
          <Field label={t("auth.instType")}>
            <select name="instType">{["PRIMARY_SCHOOL", "SECONDARY_SCHOOL", "COLLEGE", "UNIVERSITY"].map((k) => <option key={k} value={k}>{t(`type.${k}`)}</option>)}</select>
          </Field>
          <Field label={t("auth.district")}><input name="district" /></Field>
          <Field label={t("auth.contactEmail")}><input name="contactEmail" type="email" required /></Field>
        </>}
        <Field label={t("common.password")} hint={t("auth.passwordHelp")}><input name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
        <label className="check"><input name="consent" type="checkbox" required /><span>{t("auth.consent")}</span></label>
        <Msg kind="err">{err}</Msg>
        <Btn busy={busy} style={{ width: "100%" }}>{t("auth.signUp")}</Btn>
        <p>{t("auth.haveAccount")} <Link href="/login">{t("auth.signIn")}</Link></p>
      </form>
    </AuthLayout>
  );
}
