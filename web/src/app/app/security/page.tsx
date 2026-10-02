"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Btn, Card, Field, Msg, Page, useBusy } from "@/lib/ui";

export default function Security() {
  const { t } = useT();
  const { user, signIn } = useSession();
  const { busy, msg, run } = useBusy();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState(""), [code, setCode] = useState("");

  useEffect(() => { if (user && !user.mfaEnabled) post("/auth/mfa/setup").then(setSetup).catch(() => {}); }, [user]);
  useEffect(() => { if (setup) QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 220 }).then(setQr); }, [setup]);

  if (!user) return null;
  return (
    <Page title={t("mfa.title")}>
      <Card>
        <p>{t("mfa.why")}</p>
        {user.mfaEnabled ? <Msg kind="ok">{t("mfa.enabled")}</Msg> : setup && (
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await signIn("mfa-enable", { code }); }); }}>
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
    </Page>
  );
}
