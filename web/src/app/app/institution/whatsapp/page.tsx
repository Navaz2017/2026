"use client";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Badge, Btn, Card, Loading, Msg, Page, confirmBox, useBusy, useLoad } from "@/lib/ui";

export default function WhatsApp() {
  const { t } = useT();
  const { user } = useSession();
  const { data: s, error, loading, reload } = useLoad<any>("/institution/whatsapp");
  const { busy, msg, run } = useBusy();
  const [img, setImg] = useState("");

  // Poll while pairing so the QR (which WhatsApp rotates every ~20 s) stays fresh and the page flips to "Linked".
  useEffect(() => {
    if (!s || !s.desired || s.status === "CONNECTED" || s.status === "FAILED") return;
    const id = setInterval(reload, 3000);
    return () => clearInterval(id);
  }, [s, reload]);
  useEffect(() => { if (s?.qr) QRCode.toDataURL(s.qr, { margin: 1, width: 260 }).then(setImg); else setImg(""); }, [s?.qr]);

  return (
    <Page title={t("nav.whatsapp")}>
      <p className="muted">{t("inst.waIntro")}</p>
      <Msg kind="warn">{t("inst.waWarn")}</Msg>
      {!user?.mfa && <Msg kind="warn">{t("mfa.required")} <Link href="/app/security">{t("mfa.goSetup")}</Link></Msg>}
      <Loading error={error} loading={loading} />
      {s && <Card>
        <div className="row"><Badge ns="st.wa" value={s.status} /></div>
        {s.status === "CONNECTED" && <p>✓ {t("inst.waLinkedAs", { phone: s.phone ?? "" })}</p>}
        {s.status === "QR" && <><p>{t("inst.waScan")}</p>{img && <div className="qr"><img src={img} alt="WhatsApp QR" width={260} height={260} /></div>}</>}
        {s.status === "FAILED" && <Msg kind="err">{s.lastError}</Msg>}
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
        <div className="row" style={{ marginTop: ".75rem" }}>
          {!s.desired || s.status === "FAILED" || s.status === "DISCONNECTED"
            ? <Btn busy={busy} disabled={!user?.mfa} onClick={() => run(async () => { await post("/institution/whatsapp/connect"); await reload(); })}>💬 {t("inst.waConnect")}</Btn>
            : <Btn kind="danger" busy={busy} disabled={!user?.mfa} onClick={() => confirmBox(t("inst.waDisconnect") + "?") && run(async () => { await post("/institution/whatsapp/disconnect"); await reload(); })}>{t("inst.waDisconnect")}</Btn>}
        </div>
      </Card>}
    </Page>
  );
}
