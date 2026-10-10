"use client";
import { useEffect, useState } from "react";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Card, Empty, Loading, Msg, Page, dt, useLoad } from "@/lib/ui";

export default function FamilySchool() {
  const { t } = useT();
  const { user } = useSession();
  const kids = useLoad<any[]>("/me/school/children");
  const [sel, setSel] = useState<{ sid: string; inst: string } | null>(null);
  const [tab, setTab] = useState<"progress" | "attendance" | "notices">("progress");
  const options = (kids.data ?? []).flatMap((k) => k.enrolments.map((e: any) => ({ sid: k.id, inst: e.institution.id, label: `${k.fullName} — ${e.institution.name}${e.class ? ` (${e.class.name})` : ""}` })));
  useEffect(() => { if (!sel && options[0]) setSel(options[0]); }, [kids.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = sel ? `/me/school/children/${sel.sid}` : "";
  const path = sel ? `${q}/${tab === "notices" ? "announcements" : tab}?institutionId=${sel.inst}` : null;
  const d = useLoad<any>(path, [tab, sel?.sid, sel?.inst]);
  return (
    <Page title={t("nav.mySchool")}>
      <Loading error={kids.data ? null : kids.error} loading={kids.loading} />
      {(kids.data ? options.length === 0 : !!kids.error) && <Msg kind="info">{user?.role === "PARENT" ? t("sh.notLinked") : t("sh.notLinkedStudent")}</Msg>}
      {options.length > 0 && <>
        <select value={sel ? `${sel.sid}|${sel.inst}` : ""} onChange={(e) => { const [sid, inst] = e.target.value.split("|"); setSel({ sid: sid!, inst: inst! }); }}>
          {options.map((o) => <option key={o.sid + o.inst} value={`${o.sid}|${o.inst}`}>{o.label}</option>)}
        </select>
        <div className="tabs">{(["progress", "attendance", "notices"] as const).map((x) => <button key={x} className={`tab ${x === tab ? "on" : ""}`} onClick={() => setTab(x)}>{t(`sh.tab.${x}`)}</button>)}</div>
        <Loading error={d.error} loading={d.loading} />
        {tab === "progress" && d.data?.subjects && <>
          {d.data.overallAverage != null && <p><strong>{t("sh.overall")}: {d.data.overallAverage}%</strong></p>}
          {d.data.subjects.length === 0 && <Empty />}
          {d.data.subjects.map((s: any) => (
            <Card key={s.subject} title={`${s.subject}${s.average != null ? ` — ${s.average}%${s.grade ? ` (${s.grade})` : ""}` : ""}`}>
              {s.items.map((i: any) => (
                <div key={i.id} style={{ marginBottom: ".5rem" }}>
                  <strong>{i.title}</strong> · {i.score ?? "—"}/{i.maxScore}{i.grade ? ` · ${i.grade}` : ""} <span className="muted">{t("sh.term")} {i.termNo}</span>
                  {i.feedback && <div className="muted">“{i.feedback}”</div>}
                </div>
              ))}
            </Card>
          ))}
        </>}
        {tab === "attendance" && d.data?.summary && <>
          <p><strong>{d.data.summary.rate ?? "—"}%</strong> · {t("sh.att.PRESENT")} {d.data.summary.present} · {t("sh.att.ABSENT")} {d.data.summary.absent} · {t("sh.att.LATE")} {d.data.summary.late} · {t("sh.att.EXCUSED")} {d.data.summary.excused}</p>
          {d.data.records.filter((r: any) => r.status !== "PRESENT").map((r: any) => <div key={r.date} className="row">{dt(r.date)} · {t(`sh.att.${r.status}`)}{r.note ? ` · ${r.note}` : ""}</div>)}
        </>}
        {tab === "notices" && Array.isArray(d.data) && <>
          {d.data.length === 0 && <Empty />}
          {d.data.map((a: any) => (
            <Card key={a.id} title={`${a.urgent ? "⚠ " : ""}${a.title}`}>
              <p>{a.body}</p><p className="muted">{dt(a.createdAt)}</p>
              {!a.read && <button className="btn" onClick={() => post(`/me/school/announcements/${a.id}/read`).then(d.reload)}>{t("sh.markRead")}</button>}
            </Card>
          ))}
        </>}
      </>}
    </Page>
  );
}
