"use client";
import { useState } from "react";
import { post } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { useT } from "@/lib/i18n";
import { Btn, Card, Empty, Field, Loading, Msg, Page, confirmBox, dt, useBusy, useLoad } from "@/lib/ui";

export default function Users() {
  const { t } = useT();
  const [role, setRole] = useState(""), [q, setQ] = useState("");
  const { data, error, loading, reload } = useLoad<any[]>(`/admin/users?q=${encodeURIComponent(q)}${role ? `&role=${role}` : ""}`);
  const { busy, msg, run } = useBusy();
  return (
    <Page title={t("usr.title")}>
      <div className="tabs">{["", "PARENT", "STUDENT", "INSTITUTION_ADMIN", "SYSTEM_OWNER"].map((r) => <button key={r} className={`tab ${r === role ? "on" : ""}`} onClick={() => setRole(r)}>{r ? t(`role.${r}`) : t("common.all")}</button>)}</div>
      <Field label={t("common.search")}><input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      <Loading error={error} loading={loading} />
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {data?.length === 0 && <Empty />}
      <Card><div className="tblwrap"><table className="tbl"><thead><tr><th>{t("common.name")}</th><th>{t("common.email")}</th><th>{t("usr.role")}</th><th>{t("common.language")}</th><th>{t("usr.mfa")}</th><th>{t("common.date")}</th><th /></tr></thead>
        <tbody>{data?.map((u) => <tr key={u.id}>
          <td>{u.fullName}</td><td>{u.email}</td><td>{t(`role.${u.role}`)}</td><td>{u.language}</td><td>{u.mfaEnabled ? <Icon name="check" size={16} /> : "—"}</td><td>{dt(u.createdAt)}</td>
          <td><div className="row">{u.mfaEnabled && <Btn kind="ghost" busy={busy} onClick={() => confirmBox(t("usr.resetMfaConfirm")) && run(async () => { await post(`/admin/users/${u.id}/reset-mfa`); await reload(); })}>{t("usr.resetMfa")}</Btn>}{u.disabledAt ? <Btn kind="ghost" busy={busy} onClick={() => run(async () => { await post(`/admin/users/${u.id}/enable`); await reload(); })}>{t("usr.enable")}</Btn>
            : <Btn kind="danger" busy={busy} onClick={() => run(async () => { await post(`/admin/users/${u.id}/disable`); await reload(); })}>{t("usr.disable")}</Btn>}</div></td></tr>)}</tbody></table></div></Card>
    </Page>
  );
}
