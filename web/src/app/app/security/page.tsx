"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Btn, Card, Field, Msg, Page, confirmBox, useBusy } from "@/lib/ui";

function RecoveryCodes({ codes }: { codes: string[] }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Card title={t("sec.recoveryTitle")}>
      <Msg kind="warn">{t("sec.recoveryHelp")}</Msg>
      <div className="grid two mono" style={{ fontSize: "1.15rem", margin: ".5rem 0" }} data-testid="recovery-codes">{codes.map((c) => <div key={c}>{c}</div>)}</div>
      <div className="row">
        <Btn kind="ghost" onClick={async () => { await navigator.clipboard.writeText(codes.join("\n")).catch(() => {}); setCopied(true); }}>{copied ? t("common.copied") : t("sec.copyAll")}</Btn>
        <Btn kind="ghost" onClick={() => window.print()}>{t("sec.print")}</Btn>
      </div>
    </Card>
  );
}

function ChangePassword() {
  const { t } = useT();
  const { signIn } = useSession();
  const [cur, setCur] = useState(""), [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null), [busy, setBusy] = useState(false);
  return (
    <Card title={t("sec.changeTitle")}>
      <form onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setMsg(null);
        try { await signIn("change-password", { currentPassword: cur, newPassword: next }); setCur(""); setNext(""); setMsg({ kind: "ok", text: t("sec.changed") }); }
        catch (x: any) { setMsg({ kind: "err", text: t(`err.${x.code}`) === `err.${x.code}` ? t("err.validation") : t(`err.${x.code}`) }); }
        finally { setBusy(false); }
      }}>
        <Field label={t("sec.current")}><input type="password" required autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label={t("sec.new")} hint={t("auth.passwordHelp")}><input type="password" required minLength={10} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
        <Btn busy={busy}>{t("sec.changeTitle")}</Btn>
      </form>
    </Card>
  );
}

export default function Security() {
  const { t } = useT();
  const { user, signIn, reload } = useSession();
  const { busy, msg, run } = useBusy();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState(""), [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const needsMfa = user?.role === "SYSTEM_OWNER" || user?.role === "INSTITUTION_ADMIN";

  useEffect(() => { if (user && needsMfa && !user.mfaEnabled) post("/auth/mfa/setup").then(setSetup).catch(() => {}); }, [user, needsMfa]);
  useEffect(() => { if (setup) QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 220 }).then(setQr); }, [setup]);
  if (!user) return null;

  return (
    <Page title={t("nav.security")}>
      {needsMfa && (
        <Card title={t("mfa.title")}>
          <p>{t("mfa.why")}</p>
          {user.mfaEnabled ? <Msg kind="ok">{t("mfa.enabled")}</Msg> : setup && (
            <form onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await signIn("mfa-enable", { code }); setCodes(r.recoveryCodes ?? null); }); }}>
              <p>{t("mfa.step1")}</p>
              <p>{t("mfa.step2")}</p>
              {qr && <div className="qr"><img src={qr} alt="" width={220} height={220} /></div>}
              <p className="mono">{setup.secret}</p>
              <Field label={t("mfa.step3")}><input inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required /></Field>
              {msg && <Msg kind={msg.kind}>{msg.kind === "err" ? t("mfa.wrong") : msg.text}</Msg>}
              <Btn busy={busy}>{t("mfa.enable")}</Btn>
            </form>
          )}
        </Card>
      )}
      {codes && <RecoveryCodes codes={codes} />}
      {needsMfa && user.mfaEnabled && user.mfa && (
        <Card>
          <p className="muted" data-testid="codes-left">{t("sec.recoveryLeft", { n: user.recoveryCodesLeft ?? 0 })}</p>
          <Btn kind="ghost" busy={busy} onClick={() => confirmBox(t("sec.regenerate") + "?") && run(async () => { setCodes((await post("/auth/mfa/recovery-codes")).recoveryCodes); await reload(); })}>{t("sec.regenerate")}</Btn>
        </Card>
      )}
      <ChangePassword />
    </Page>
  );
}
