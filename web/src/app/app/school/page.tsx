"use client";
import Link from "next/link";
import { useState } from "react";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Btn, Card, Empty, Field, Loading, Msg, Page, useBusy, useLoad } from "@/lib/ui";

const LEVELS = ["F1", "F2", "F3", "F4", "F5", "F6", "STD1", "STD2", "STD3", "STD4", "STD5", "STD6", "STD7", "STD8"];

export default function SchoolHome() {
  const { t } = useT();
  const { user } = useSession();
  const admin = user?.role === "INSTITUTION_ADMIN";
  const classes = useLoad<any[]>("/school/classes");
  const { busy, msg, run } = useBusy();
  const [f, setF] = useState({ name: "", level: "F1" });
  return (
    <Page title={t("nav.school")}>
      {admin && <div className="row" style={{ marginBottom: ".75rem" }}>
        <Link className="btn primary" href="/app/school/roster">{t("sh.roster")}</Link>
        <Link className="btn" href="/app/school/staff">{t("sh.staff")}</Link>
      </div>}
      <Loading error={classes.error} loading={classes.loading} />
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {classes.data?.length === 0 && <Empty />}
      <div className="grid two">
        {classes.data?.map((c) => (
          <Card key={c.id} title={c.name}>
            <p className="muted">{t("sh.pupils", { n: c._count.enrolments })} · {c.classTeacher?.fullName ?? t("sh.noTeacher")}</p>
          </Card>
        ))}
      </div>
      {admin && <Card title={t("sh.addClass")}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); run(async () => { await post("/school/classes", f); setF({ ...f, name: "" }); await classes.reload(); }, t("common.saved")); }}>
          <Field label={t("sh.className")}><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Form 3A" /></Field>
          <Field label={t("sh.level")}><select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></Field>
          <Btn busy={busy}>{t("common.add")}</Btn>
        </form>
      </Card>}
    </Page>
  );
}
