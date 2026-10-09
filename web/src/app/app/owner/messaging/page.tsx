"use client";
import { useState } from "react";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Btn, Card, Field, Loading, Msg, Page, useBusy, useLoad } from "@/lib/ui";
import { WhatsAppLink } from "@/components/WhatsAppLink";

export default function Messaging() {
  const { t } = useT();
  const { data: s, error, loading, reload } = useLoad<any>("/admin/messaging");
  const test = useBusy();
  const [phone, setPhone] = useState("");
  return (
    <Page title={t("nav.messaging")}>
      <p className="muted">{t("msg.intro")}</p>
      <Msg kind="warn">{t("inst.waWarn")}</Msg>
      <Loading error={error} loading={loading && !s} />
      {s && <>
        <h2>{t("msg.waTitle")}</h2>
        <p className="muted">{t("msg.waHelp")}</p>
        <WhatsAppLink s={s.whatsapp} reload={reload} canAct
          checks={[{ ok: s.whatsapp.workerOnline, ok_text: t("wa.ck.service"), bad_text: t("wa.ck.serviceBad") }]}
          connect={(p) => post("/admin/messaging/whatsapp/connect", p ? { phone: p } : {})}
          disconnect={() => post("/admin/messaging/whatsapp/disconnect")} />
        <Card>
          <h2>{t("msg.smsTitle")}</h2>
          <Msg kind={s.sms.configured ? "ok" : "warn"}>{s.sms.configured ? t("msg.smsOn", { env: s.sms.env }) : t("msg.smsOff")}</Msg>
        </Card>
        <Card title={t("msg.sendTest")}>
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
