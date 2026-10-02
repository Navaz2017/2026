"use client";
import { useState } from "react";
import { del, post } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { useT } from "@/lib/i18n";
import { Btn, Card, Empty, Field, Loading, Msg, Page, confirmBox, dtt, useBusy, useLoad } from "@/lib/ui";

export default function Devices() {
  const { t } = useT();
  const { data, error, loading, reload } = useLoad<any[]>("/admin/devices");
  const { busy, msg, run } = useBusy();
  const [label, setLabel] = useState(""), [fresh, setFresh] = useState<{ id: string; key: string } | null>(null), [copied, setCopied] = useState("");
  const copy = async (s: string) => { await navigator.clipboard.writeText(s).catch(() => {}); setCopied(s); };

  return (
    <Page title={t("dev.title")}>
      <p className="muted">{t("dev.intro")}</p>
      <Card>
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { setFresh(await post("/admin/devices", { label })); setLabel(""); await reload(); }); }}>
          <Field label={t("dev.label")}><input value={label} onChange={(e) => setLabel(e.target.value)} required minLength={2} /></Field>
          <Btn busy={busy}>{t("dev.create")}</Btn>
        </form>
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
        {fresh && <Msg kind="warn">
          <strong>{t("dev.keyOnce")}</strong>
          <div>{t("dev.id")}: <span className="mono">{fresh.id}</span> <button className="linkbtn" onClick={() => copy(fresh.id)}>{copied === fresh.id ? t("common.copied") : t("common.copy")}</button></div>
          <div>{t("dev.key")}: <span className="mono">{fresh.key}</span> <button className="linkbtn" onClick={() => copy(fresh.key)}>{copied === fresh.key ? t("common.copied") : t("common.copy")}</button></div>
        </Msg>}
      </Card>
      <Loading error={error} loading={loading} />
      {data?.length === 0 && <Empty />}
      {data?.map((d) => (
        <Card key={d.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div><strong>{d.label}</strong> {d.revokedAt && <span className="badge bad"><Icon name="x" size={14} />{t("usr.blocked")}</span>}
              <div className="muted">{t("dev.lastSeen")}: {d.lastSeen ? dtt(d.lastSeen) : t("dev.never")} · {t("dev.messages")}: {d._count.messages}</div></div>
            {!d.revokedAt && <Btn kind="danger" busy={busy} onClick={() => confirmBox(t("dev.revoke") + "?") && run(async () => { await del(`/admin/devices/${d.id}`); await reload(); })}>{t("dev.revoke")}</Btn>}
          </div>
        </Card>
      ))}
    </Page>
  );
}
