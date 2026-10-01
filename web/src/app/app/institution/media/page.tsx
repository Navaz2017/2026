"use client";
import { useState } from "react";
import { del, uploadFile } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Btn, Card, Empty, Field, Loading, Msg, Page, confirmBox, useBusy, useLoad } from "@/lib/ui";

export default function Gallery() {
  const { t } = useT();
  const { data, error, loading, reload } = useLoad<any[]>("/institution/media");
  const { busy, msg, run } = useBusy();
  const [caption, setCaption] = useState("");
  return (
    <Page title={t("nav.gallery")}>
      <p className="muted">{t("inst.mediaIntro")}</p>
      <Card>
        <Field label={t("inst.caption")}><input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} /></Field>
        <Field label={t("inst.addMedia")}>
          <input type="file" accept="image/jpeg,image/png,video/mp4" disabled={busy} onChange={(e) => {
            const file = e.target.files?.[0]; if (!file) return;
            run(async () => { await uploadFile("/institution/media/upload-url", "/institution/media", file, { kind: file.type.startsWith("video") ? "VIDEO" : "IMAGE", caption: caption || undefined }); setCaption(""); await reload(); }, t("common.saved"));
            e.target.value = "";
          }} />
        </Field>
        {busy && <p className="muted">{t("common.uploading")}</p>}
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      </Card>
      <Loading error={error} loading={loading} />
      {data?.length === 0 && <Empty />}
      <div className="grid two">{data?.map((m) => (
        <Card key={m.id}>
          {m.kind === "VIDEO" ? <video src={m.url} controls style={{ width: "100%", borderRadius: 8 }} /> : <img src={m.url} alt={m.caption ?? ""} style={{ width: "100%", borderRadius: 8 }} />}
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>{m.caption}</span>
            <span className={`badge ${m.approved ? "good" : "wait"}`}>{m.approved ? "✓" : "…"} {m.approved ? t("inst.mediaVisible") : t("inst.mediaHidden")}</span>
          </div>
          <Btn kind="danger" onClick={() => confirmBox(t("common.delete") + "?") && run(async () => { await del(`/institution/media/${m.id}`); await reload(); })}>{t("common.delete")}</Btn>
        </Card>
      ))}</div>
    </Page>
  );
}
