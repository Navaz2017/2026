"use client";
import { useEffect, useState } from "react";
import { post, put } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Btn, Card, Field, Loading, Msg, Page, useBusy, useLoad } from "@/lib/ui";

function Editor({ kind, init, signatory0 }: { kind: "ACCEPTANCE" | "REJECTION"; init: string; signatory0: string }) {
  const { t } = useT();
  const [body, setBody] = useState(init), [sig, setSig] = useState(signatory0), [preview, setPreview] = useState("");
  const { busy, msg, run } = useBusy();
  return (
    <Card title={t(kind === "ACCEPTANCE" ? "inst.letterAcceptance" : "inst.letterRejection")}>
      <Field label=" "><textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 200 }} /></Field>
      <Field label={t("inst.signatory")}><input value={sig} onChange={(e) => setSig(e.target.value)} maxLength={120} /></Field>
      <div className="row">
        <Btn kind="ghost" busy={busy} onClick={() => run(async () => setPreview((await post("/institution/letter-templates/preview", { body, signatory: sig })).text))}>{t("inst.preview")}</Btn>
        <Btn busy={busy} onClick={() => run(() => put(`/institution/letter-templates/${kind}`, { body, signatory: sig || undefined }), t("common.saved"))}>{t("common.save")}</Btn>
      </div>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {preview && <pre className="card" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{preview}</pre>}
    </Card>
  );
}

export default function Letters() {
  const { t } = useT();
  const { data, error, loading } = useLoad<any>("/institution/letter-templates");
  return (
    <Page title={t("nav.letters")}>
      <Loading error={error} loading={loading} />
      {data && <>
        <p className="muted">{t("inst.placeholders", { list: data.placeholders.map((p: string) => `{{${p}}}`).join(", ") })}</p>
        {data.templates.map((x: any) => <Editor key={x.kind} kind={x.kind} init={x.body} signatory0={x.signatory} />)}
      </>}
    </Page>
  );
}
