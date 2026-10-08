"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Badge, Btn, Card, Field, Loading, Msg, Page, confirmBox, useBusy, useLoad } from "@/lib/ui";

export default function Messaging() {
  const { t } = useT();
  const { data: s, error, loading, reload } = useLoad<any>("/admin/messaging");
  const { busy, msg, run } = useBusy();
  const test = useBusy();
  const [img, setImg] = useState(""), [phone, setPhone] = useState("");
  const w = s?.whatsapp;

  useEffect(() => {
    if (!w || !w.desired || w.status === "CONNECTED" || w.status === "FAILED") return;
    const id = setInterval(reload, 3000); // the QR rotates every ~20 s
    return () => clearInterval(id);
  }, [w, reload]);
  useEffect(() => { if (w?.qr) QRCode.toDataURL(w.qr, { margin: 1, width: 260 }).then(setImg); else setImg(""); }, [w?.qr]);

  return (
    <Page title={t("nav.messaging")}>
      <p className="muted">{t("msg.intro")}</p>
      <Loading error={error} loading={loading} />
      {s && <>
        <Card>
          <h2>{t("msg.waTitle")}</h2>
          <p className="muted">{t("msg.waHelp")}</p>
          <Msg kind="warn">{t("inst.waWarn")}</Msg>
          <div className="row"><Badge ns="st.wa" value={w.status} /></div>
          {w.status === "CONNECTED" && <Msg kind="ok">{t("inst.waLinkedAs", { phone: w.phone ?? "" })}</Msg>}
          {w.status === "QR" && <><p>{t("inst.waScan")}</p>{img && <div className="qr"><img src={img} alt="WhatsApp QR" width={260} height={260} /></div>}</>}
          {w.status === "FAILED" && <Msg kind="err">{w.lastError}</Msg>}
          {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
          <div className="row" style={{ marginTop: ".75rem" }}>
            {!w.desired || w.status === "FAILED" || w.status === "DISCONNECTED"
              ? <Btn busy={busy} onClick={() => run(async () => { await post("/admin/messaging/whatsapp/connect"); await reload(); })}>{t("inst.waConnect")}</Btn>
              : <Btn kind="danger" busy={busy} onClick={() => confirmBox(t("inst.waDisconnect") + "?") && run(async () => { await post("/admin/messaging/whatsapp/disconnect"); await reload(); })}>{t("inst.waDisconnect")}</Btn>}
          </div>
        </Card>
        <Card>
          <h2>{t("msg.smsTitle")}</h2>
          <Msg kind={s.sms.configured ? "ok" : "warn"}>{s.sms.configured ? t("msg.smsOn", { env: s.sms.env }) : t("msg.smsOff")}</Msg>
        </Card>
        <Card>
          <form onSubmit={async (e) => { e.preventDefault(); await test.run(async () => { const r = await post<any>("/admin/messaging/test", { phone }); if (!r?.channel) throw Object.assign(new Error("x"), { code: "otp_undeliverable" }); test.setMsg({ kind: "ok", text: t("msg.testSent", { channel: t(`auth.ch.${r.channel}`) }) }); }); }}>
            <Field label={t("msg.test")}><input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0999 123 456" /></Field>
            {test.msg && <Msg kind={test.msg.kind}>{test.msg.text}</Msg>}
            <Btn busy={test.busy}>{t("msg.sendTest")}</Btn>
          </form>
        </Card>
      </>}
    </Page>
  );
}
