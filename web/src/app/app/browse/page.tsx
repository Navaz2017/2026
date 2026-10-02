"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Badge, Btn, Card, Empty, Field, Loading, Msg, Page, dt, mk, useBusy, useLoad } from "@/lib/ui";

export default function Browse() {
  const { t } = useT();
  const router = useRouter();
  const [q, setQ] = useState(""), [type, setType] = useState("");
  const progs = useLoad<any[]>(`/public/programs?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ""}`);
  const kids = useLoad<any[]>("/me/students");
  const [sel, setSel] = useState<any>(null), [who, setWho] = useState(""), [statement, setStatement] = useState(""), [creds, setCreds] = useState<string[]>([]);
  const sid = who || kids.data?.[0]?.id;
  const myCreds = useLoad<any[]>(sel && sid ? `/me/students/${sid}/credentials` : null, [sel, sid]);
  const { busy, msg, run } = useBusy();

  const apply = () => run(async () => {
    await post("/me/applications", { studentId: sid, programId: sel.id, statement: statement || undefined, credentialIds: creds, clientId: crypto.randomUUID() });
    router.push("/app/family/applications");
  });

  return (
    <Page title={t("nav.browse")}>
      <div className="grid two">
        <Field label={t("fam.search")}><input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Field label={t("auth.instType")}><select value={type} onChange={(e) => setType(e.target.value)}><option value="">{t("fam.allTypes")}</option>{["PRIMARY_SCHOOL", "SECONDARY_SCHOOL", "COLLEGE", "UNIVERSITY"].map((k) => <option key={k} value={k}>{t(`type.${k}`)}</option>)}</select></Field>
      </div>
      <Loading error={progs.error} loading={progs.loading} />
      {progs.data?.length === 0 && <Empty />}
      {progs.data?.map((p) => {
        const left = p.seats - p.seatsTaken;
        return (
          <Card key={p.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div><strong>{p.title}</strong> <span className="muted">· {p.level}</span>
                <div>{p.institution.name} <span className="muted">· {t(`type.${p.institution.type}`)} · {p.institution.district ?? ""}</span></div>
                <div className="muted">{t("fam.totalFee")}: <strong>{mk(p.totalDueMinor)}</strong> · {left > 0 ? t("fam.seatsLeft", { n: left }) : t("fam.full")}{p.closesAt && ` · ${t("fam.closesOn", { date: dt(p.closesAt) })}`}</div></div>
              <Btn disabled={left <= 0} onClick={() => { setSel(sel?.id === p.id ? null : p); setCreds([]); }}>{t("fam.apply")}</Btn>
            </div>
            {sel?.id === p.id && <div style={{ marginTop: ".75rem" }}>
              {["PRIMARY_SCHOOL", "SECONDARY_SCHOOL"].includes(p.institution.type) && <Msg kind="info">{t("fam.needReport")}</Msg>}
              {(kids.data?.length ?? 0) > 1 && <Field label={t("fam.whoApplies")}><select value={sid} onChange={(e) => setWho(e.target.value)}>{kids.data!.map((k) => <option key={k.id} value={k.id}>{k.fullName}</option>)}</select></Field>}
              <Field label={t("fam.attach")}>
                <div>{myCreds.data?.map((c) => <label key={c.id} className="check"><input type="checkbox" checked={creds.includes(c.id)} onChange={(e) => setCreds(e.target.checked ? [...creds, c.id] : creds.filter((x) => x !== c.id))} /><span>{c.title} <span className="muted">· {t(`dockind.${c.kind}`) === `dockind.${c.kind}` ? c.kind : t(`dockind.${c.kind}`)}</span></span></label>)}</div>
              </Field>
              <Field label={t("fam.statement")}><textarea style={{ minHeight: 90 }} value={statement} onChange={(e) => setStatement(e.target.value)} maxLength={3000} /></Field>
              {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
              <Btn busy={busy} disabled={!sid} onClick={apply}>{t("fam.apply")}</Btn>
            </div>}
          </Card>
        );
      })}
      <span hidden><Badge ns="st.app" value="DRAFT" /></span>
    </Page>
  );
}
