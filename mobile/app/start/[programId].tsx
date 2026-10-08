import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { post } from "../../src/api";
import { useT } from "../../src/i18n";
import { useResource } from "../../src/offline";
import { useSession } from "../../src/session";
import { Btn, Card, Loading, Msg, Screen, Select, useBusy } from "../../src/ui";

// Needs a connection: the server creates (or resumes) the draft and works out the fee.
export default function Start() {
  const { programId } = useLocalSearchParams<{ programId: string }>();
  const { t } = useT();
  const { user } = useSession();
  const router = useRouter();
  const kids = useResource<any[]>("/me/students");
  const [who, setWho] = useState("");
  const { busy, msg, run } = useBusy();
  const go = (studentId: string) => run(async () => { const d = await post("/me/applications/draft", { studentId, programId }); router.replace(`/apply/${d.id}`); });
  useEffect(() => { if (kids.data?.length === 1 && !busy && !msg) void go(kids.data[0].id); }, [kids.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return <Redirect href="/login" />;
  return (
    <Screen>
      <Loading error={kids.error} loading={kids.loading || busy} />
      {kids.data?.length === 0 && <Card><Msg kind="warn">{t("common.none")}</Msg><Btn label={t("fam.addChild")} onPress={() => router.replace("/children")} /></Card>}
      {(kids.data?.length ?? 0) > 1 && <Card><Select label={t("wiz.whoApplies")} value={who} required onChange={setWho} options={kids.data!.map((k): [string, string] => [k.id, k.fullName])} /><Btn label={t("fam.start")} disabled={!who} busy={busy} onPress={() => go(who)} /></Card>}
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {msg && <Btn kind="ghost" label={t("nav.myApps")} onPress={() => router.replace("/applications")} />}
    </Screen>
  );
}
