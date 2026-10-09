"use client";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Loading, Msg, Page, useLoad } from "@/lib/ui";
import { WhatsAppLink } from "@/components/WhatsAppLink";

// Each institution links ITS OWN WhatsApp number here (never shared with other institutions or the platform).
export default function WhatsApp() {
  const { t } = useT();
  const { data: s, error, loading, reload } = useLoad<any>("/institution/whatsapp");
  return (
    <Page title={t("nav.whatsapp")}>
      <p className="muted">{t("inst.waIntro")}</p>
      <Msg kind="warn">{t("inst.waWarn")}</Msg>
      <Loading error={error} loading={loading && !s} />
      {s && <WhatsAppLink s={s} reload={reload} canAct={s.mfa && s.institutionVerified}
        checks={[
          { ok: s.workerOnline, ok_text: t("wa.ck.service"), bad_text: t("wa.ck.serviceBad") },
          { ok: s.institutionVerified, ok_text: t("wa.ck.verified"), bad_text: t("wa.ck.verifiedBad") },
          { ok: s.mfa, ok_text: t("wa.ck.mfa"), bad_text: t("wa.ck.mfaBad") },
        ]}
        connect={(phone) => post("/institution/whatsapp/connect", phone ? { phone } : {})}
        disconnect={() => post("/institution/whatsapp/disconnect")}
        test={(phone) => post("/institution/whatsapp/test", { phone })} />}
    </Page>
  );
}
