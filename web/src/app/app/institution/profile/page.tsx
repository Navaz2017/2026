"use client";
import { useEffect, useState } from "react";
import { patch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Area, Sel, Txt } from "@/components/Fields";
import { Btn, Card, Loading, Msg, Page, useBusy, useLoad } from "@/lib/ui";
import { PERIODS, isSchool, levelLabel, levelsFor } from "@/lib/forms";

export default function Profile() {
  const { t } = useT();
  const { data: me, error, loading, reload } = useLoad<any>("/institution/me");
  const [f, setF] = useState<any>({ description: "", website: "", campuses: "", highestLevel: "", syllabi: [] as string[] });
  const [fees, setFees] = useState<{ name: string; amount: string; period: string }[]>([]);
  const { busy, msg, run } = useBusy();
  useEffect(() => { if (me) { setF({ description: me.description ?? "", website: me.website ?? "", campuses: (me.campuses ?? []).join(", "), highestLevel: me.highestLevel ?? "", syllabi: me.syllabi ?? [] }); setFees((me.otherFees ?? []).map((x: any) => ({ name: x.name, amount: String(x.amountMinor / 100), period: x.period }))); } }, [me]);
  if (!me) return <Page title={t("ip.title")}><Loading error={error} loading={loading} /></Page>;
  const school = isSchool(me.type), secondary = me.type === "SECONDARY_SCHOOL";
  const save = () => run(async () => {
    await patch("/institution/me", {
      description: f.description || undefined, website: f.website || undefined,
      campuses: f.campuses.split(",").map((x: string) => x.trim()).filter(Boolean),
      ...(school && { highestLevel: f.highestLevel || null, ...(secondary && { syllabi: f.syllabi }) }),
      otherFees: fees.filter((x) => x.name && x.amount !== "").map((x) => ({ name: x.name, amountMinor: Math.round(Number(x.amount) * 100), period: x.period })),
    });
    await reload();
  }, t("common.saved"));
  return (
    <Page title={t("ip.title")}>
      <Card>
        <Area label={t("ip.desc")} value={f.description} onChange={(x) => setF({ ...f, description: x })} maxLength={2000} />
        <Txt label={t("ip.website")} type="url" value={f.website} onChange={(x) => setF({ ...f, website: x })} />
        <Txt label={t("ip.campuses")} value={f.campuses} onChange={(x) => setF({ ...f, campuses: x })} />
        {school && <>
          <Sel label={t("ip.highest")} value={f.highestLevel} onChange={(x) => setF({ ...f, highestLevel: x })} options={levelsFor(me.type).map((l) => [l, levelLabel(l)])} />
          <p className="muted" style={{ marginTop: "-.5rem" }}>{t("ip.highestHelp")}</p>
          {secondary && <div className="field"><span style={{ fontWeight: 600 }}>{t("ip.syllabi")}</span>
            <div className="row">{["MSCE", "CAMBRIDGE"].map((s) => <label key={s} className="check" style={{ margin: 0 }}><input type="checkbox" checked={f.syllabi.includes(s)} onChange={(e) => setF({ ...f, syllabi: e.target.checked ? [...f.syllabi, s] : f.syllabi.filter((x: string) => x !== s) })} /><span>{t(`syll.${s}`)}</span></label>)}</div></div>}
        </>}
      </Card>
      <Card title={t("ip.otherFees")}>
        {fees.map((x, i) => (
          <div key={i} className="grid two">
            <Txt label={t("ip.feeName")} value={x.name} onChange={(v) => setFees(fees.map((y, j) => (j === i ? { ...y, name: v } : y)))} />
            <Txt label={t("ip.amount")} type="number" min={0} value={x.amount} onChange={(v) => setFees(fees.map((y, j) => (j === i ? { ...y, amount: v } : y)))} />
            <Sel label={t("inst.periodF")} required value={x.period} onChange={(v) => setFees(fees.map((y, j) => (j === i ? { ...y, period: v } : y)))} options={PERIODS.map((p) => [p, t(`period.${p}`)])} />
            <div><button type="button" className="linkbtn" onClick={() => setFees(fees.filter((_, j) => j !== i))}>{t("wiz.remove")}</button></div>
          </div>
        ))}
        {fees.length < 20 && <Btn kind="ghost" onClick={() => setFees([...fees, { name: "", amount: "", period: "SEMESTER" }])}>{t("ip.addFee")}</Btn>}
      </Card>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Btn busy={busy} onClick={save}>{t("common.save")}</Btn>
    </Page>
  );
}
