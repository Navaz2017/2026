"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Btn, Card, Loading, Msg, Page, useBusy, useLoad } from "@/lib/ui";
import { Sel } from "@/components/Fields";
import { Wizard } from "@/components/wizard/Wizard";

function Start({ programId }: { programId: string }) {
  const { t } = useT();
  const router = useRouter();
  const kids = useLoad<any[]>("/me/students");
  const [who, setWho] = useState("");
  const { busy, msg, run } = useBusy();
  const go = (studentId: string) => run(async () => { const d = await post("/me/applications/draft", { studentId, programId }); router.replace(`/app/apply?draft=${d.id}`); });
  useEffect(() => { if (kids.data?.length === 1 && !busy && !msg) go(kids.data[0].id); }, [kids.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (kids.data && kids.data.length === 0) return <Msg kind="warn">{t("common.none")} <Link href="/app/family">{t("fam.addChild")}</Link></Msg>;
  return (
    <>
      <Loading error={kids.error} loading={kids.loading || busy} />
      {(kids.data?.length ?? 0) > 1 && <Card><Sel label={t("wiz.whoApplies")} value={who} required onChange={setWho} options={kids.data!.map((k) => [k.id, k.fullName])} /><Btn disabled={!who} busy={busy} onClick={() => go(who)}>{t("fam.start")}</Btn></Card>}
      {msg && <Msg kind={msg.kind}>{msg.text} <Link href="/app/family/applications">{t("nav.myApps")}</Link></Msg>}
    </>
  );
}

function Inner() {
  const q = useSearchParams();
  const { t } = useT();
  const draft = q.get("draft"), program = q.get("program");
  return <Page title={t("nav.browse")}>{draft ? <Wizard appId={draft} /> : program ? <Start programId={program} /> : <Msg kind="warn"><Link href="/app/browse">{t("nav.browse")}</Link></Msg>}</Page>;
}
export default function Apply() { return <Suspense><Inner /></Suspense>; }
