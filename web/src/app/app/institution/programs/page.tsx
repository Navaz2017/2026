"use client";
import { useState } from "react";
import { patch, post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Area, Check, Sel, Txt } from "@/components/Fields";
import { ProgramFacts } from "@/components/SchoolView";
import { Badge, Btn, Card, Empty, Loading, Msg, Page, dt, mk, useBusy, useLoad } from "@/lib/ui";
import { MODES, PERIODS, allowedLevels, isSchool, levelLabel, syllabiForLevel } from "@/lib/forms";
import Link from "next/link";

export default function Programs() {
  const { t } = useT();
  const { data, error, loading, reload } = useLoad<any[]>("/institution/programs");
  const me = useLoad<any>("/institution/me");
  const { busy, msg, run } = useBusy();
  const blank = { title: "", level: "", code: "", seats: "30", fee: "10000", tuition: "", period: "SEMESTER", duration: "", entry: "", modes: [] as string[], description: "", opensAt: "", closesAt: "", classLevel: "", syllabus: "" };
  const [f, setF] = useState(blank);
  const set = (k: string) => (v: any) => setF({ ...f, [k]: v });
  const school = me.data ? isSchool(me.data.type) : false;
  const levels = me.data ? allowedLevels(me.data.type, me.data.highestLevel) : [];
  const sylls = f.classLevel ? syllabiForLevel(f.classLevel).filter((s) => me.data?.syllabi?.includes(s)) : [];

  return (
    <Page title={t("nav.programs")}>
      <Msg kind="info">{t("inst.earlyNote")}</Msg>
      <Card title={t("inst.addProgram")}>
        {school && levels.length === 0 && me.data && <Msg kind="warn">{t("inst.setHighest")} <Link href="/app/institution/profile">{t("nav.profile")}</Link></Msg>}
        <form onSubmit={(e) => { e.preventDefault(); run(async () => {
          await post("/institution/programs", {
            title: f.title || "—", level: f.level || "—", code: f.code || undefined, description: f.description || undefined, seats: +f.seats, applicationFee: Math.round(+f.fee * 100),
            tuitionFeeMinor: Math.round(+(f.tuition || 0) * 100), tuitionPeriod: f.period, duration: f.duration || undefined, entryRequirements: f.entry || undefined, modes: f.modes,
            ...(school && { classLevel: f.classLevel, syllabus: f.syllabus || undefined }), opensAt: f.opensAt || undefined, closesAt: f.closesAt || undefined,
          });
          setF({ ...blank, period: f.period }); await reload();
        }); }}>
          <div className="grid two">
            {school ? <>
              <Sel label={t("inst.classF")} required value={f.classLevel} onChange={(v) => setF({ ...f, classLevel: v, syllabus: "" })} options={levels.map((l) => [l, levelLabel(l)])} />
              {me.data?.type === "SECONDARY_SCHOOL" && f.classLevel && <Sel label={t("prog.syllabus")} required value={f.syllabus} onChange={set("syllabus")} options={sylls.map((s) => [s, t(`syll.${s}`)])} />}
            </> : <>
              <Txt label={t("inst.progTitle")} required value={f.title} onChange={set("title")} />
              <Txt label={t("inst.level")} required value={f.level} onChange={set("level")} />
              <Txt label={t("inst.codeF")} value={f.code} onChange={set("code")} />
              <Txt label={t("inst.durationF")} value={f.duration} onChange={set("duration")} />
            </>}
            <Txt label={t("inst.seatsF")} type="number" min={1} required value={f.seats} onChange={set("seats")} />
            <Txt label={t("inst.fee")} type="number" min={0} step="0.01" required value={f.fee} onChange={set("fee")} />
            <Txt label={t("inst.tuitionF")} type="number" min={0} step="0.01" required value={f.tuition} onChange={set("tuition")} />
            <Sel label={t("inst.periodF")} required value={f.period} onChange={set("period")} options={PERIODS.map((p) => [p, t(`period.${p}`)])} />
            <Txt label={t("inst.opens")} type="date" value={f.opensAt} onChange={set("opensAt")} />
            <Txt label={t("inst.closes")} type="date" value={f.closesAt} onChange={set("closesAt")} />
          </div>
          {!school && <>
            <div className="field"><span style={{ fontWeight: 600 }}>{t("inst.modesF")}</span><div className="row">{MODES.map((m) => <Check key={m} label={t(`mode.${m}`)} checked={f.modes.includes(m)} onChange={(on) => set("modes")(on ? [...f.modes, m] : f.modes.filter((x) => x !== m))} />)}</div></div>
            <Area label={t("inst.entryF")} value={f.entry} onChange={set("entry")} maxLength={1000} />
          </>}
          <Area label={t("inst.description")} value={f.description} onChange={set("description")} maxLength={2000} />
          {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
          <Btn busy={busy}>{t("common.add")}</Btn>
        </form>
      </Card>
      <Loading error={error} loading={loading} />
      {data?.length === 0 && <Empty />}
      {data?.map((p) => (
        <Card key={p.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div><strong>{p.title}</strong> <span className="muted">· {p.level}{p.code ? ` · ${p.code}` : ""}</span>
              <ProgramFacts p={p} />
              <div className="muted">{t("inst.fee")}: {mk(p.applicationFee)} · {t("inst.seatsUsed", { used: p.seatsTaken, total: p.seats })}{p.closesAt && ` · ${t("inst.closes")}: ${dt(p.closesAt)}`}</div></div>
            <div className="row"><Badge ns="st.prog" value={p.status} />{p.status !== "CLOSED" && <Btn kind="ghost" busy={busy} onClick={() => run(async () => { await patch(`/institution/programs/${p.id}`, { status: "CLOSED" }); await reload(); })}>{t("inst.closeProg")}</Btn>}</div>
          </div>
        </Card>
      ))}
    </Page>
  );
}
