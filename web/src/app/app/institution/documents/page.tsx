"use client";
import { useState } from "react";
import { uploadFile } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { useT } from "@/lib/i18n";
import { Badge, Card, Empty, Field, Loading, Msg, Page, dt, useBusy, useLoad } from "@/lib/ui";

const KINDS = ["REGISTRATION_CERT", "ACCREDITATION", "TAX_CLEARANCE", "DIRECTOR_ID", "OTHER"];
export default function Documents() {
  const { t } = useT();
  const { data, error, loading, reload } = useLoad<any>("/institution/me");
  const [kind, setKind] = useState(KINDS[0]!);
  const { busy, msg, run } = useBusy();
  return (
    <Page title={t("nav.documents")}>
      <p className="muted">{t("inst.docsIntro")}</p>
      <Loading error={error} loading={loading} />
      {data && <>
        <div className="row"><Badge ns="st.inst" value={data.status} /></div>
        <Card>
          <Field label={t("inst.docKind")}><select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{t(`doc.${k}`)}</option>)}</select></Field>
          <Field label={t("common.upload")}>
            <input type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy} onChange={(e) => {
              const file = e.target.files?.[0]; if (!file) return;
              run(async () => { await uploadFile("/institution/me/documents/upload-url", "/institution/me/documents", file, { kind }); await reload(); }, t("common.saved"));
              e.target.value = "";
            }} />
          </Field>
          {busy && <p className="muted">{t("common.uploading")}</p>}
          {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
        </Card>
        {data.documents.length === 0 && <Empty />}
        {data.documents.map((d: any) => <Card key={d.id}><Icon name="doc" size={18} /> {t(`doc.${d.kind}`) === `doc.${d.kind}` ? d.kind : t(`doc.${d.kind}`)} · {dt(d.createdAt)}</Card>)}
      </>}
    </Page>
  );
}
