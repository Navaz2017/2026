"use client";
import { useEffect, useState } from "react";
import { post, put } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Badge, Btn, Card, Field, Loading, Msg, Page, confirmBox, useBusy, useLoad } from "@/lib/ui";
import { Sel } from "@/components/Fields";
import { useSession } from "@/lib/session";

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

// When do decision letters go out? Immediately, or held and released together (by hand or on a chosen date).
function Delivery() {
  const { t } = useT();
  const { user } = useSession();
  const { data, reload } = useLoad<any>("/institution/letters/pending");
  const { busy, msg, run } = useBusy();
  const [mode, setMode] = useState<"IMMEDIATE" | "HOLD" | "">(""), [at, setAt] = useState<string | null>(null);
  if (!data) return null;
  const curMode = mode || data.mode;
  const curAt = at ?? (data.releaseAt ? toLocal(data.releaseAt) : "");
  const n = data.items.length;
  return (
    <Card title={t("lh.title")}>
      <Sel label={t("lh.mode")} required value={curMode} onChange={(v) => setMode(v as "IMMEDIATE" | "HOLD")} options={[["IMMEDIATE", t("lh.now")], ["HOLD", t("lh.hold")]]} />
      {curMode === "HOLD" && <Field label={t("lh.releaseAt")} hint={t("lh.releaseHelp")}><input type="datetime-local" value={curAt} onChange={(e) => setAt(e.target.value)} /></Field>}
      <Btn busy={busy} disabled={!user?.mfa} onClick={() => run(async () => { await put("/institution/letters/settings", { mode: curMode, releaseAt: curMode === "HOLD" && curAt ? new Date(curAt).toISOString() : null }); setMode(""); setAt(null); reload(); }, t("common.saved"))}>{t("common.save")}</Btn>
      {data.releaseAt && <p className="muted">{t("lh.scheduled", { when: new Date(data.releaseAt).toLocaleString() })}</p>}
      <h2 style={{ marginTop: "1rem" }}>{t("lh.onHold")}</h2>
      {n === 0 ? <p className="muted">{t("lh.none")}</p> : <>
        <p>{t("lh.pending", { a: data.accepted, r: data.rejected })}</p>
        <div className="tblwrap"><table className="tbl"><tbody>{data.items.slice(0, 50).map((x: any) => <tr key={x.id}><td>{x.student.fullName}</td><td>{x.program.title}</td><td><Badge ns="st.app" value={x.status} /></td></tr>)}</tbody></table></div>
        <Btn busy={busy} disabled={!user?.mfa} onClick={() => confirmBox(t("lh.confirmAll", { n })) && run(async () => { const r = await post<any>("/institution/letters/release"); reload(); return r; }, t("lh.sent", { n }))}>{t("lh.sendAll", { n })}</Btn>
      </>}
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
    </Card>
  );
}
const toLocal = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export default function Letters() {
  const { t } = useT();
  const { data, error, loading } = useLoad<any>("/institution/letter-templates");
  return (
    <Page title={t("nav.letters")}>
      <Delivery />
      <Loading error={error} loading={loading} />
      {data && <>
        <p className="muted">{t("inst.placeholders", { list: data.placeholders.map((p: string) => `{{${p}}}`).join(", ") })}</p>
        {data.templates.map((x: any) => <Editor key={x.kind} kind={x.kind} init={x.body} signatory0={x.signatory} />)}
      </>}
    </Page>
  );
}
