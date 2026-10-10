import { useState } from "react";
import { Linking } from "react-native";
import { api, uploadPicked } from "../src/api";
import { DOC_KINDS, pickFile, pickPhoto } from "../src/files";
import { useT } from "../src/i18n";
import { useResource } from "../src/offline";
import { Btn, Card, Empty, Field, Loading, Msg, P, Screen, Select, dt, useBusy } from "../src/ui";

export default function Documents() {
  const { t } = useT();
  const kids = useResource<any[]>("/me/students");
  const [who, setWho] = useState(""), [kind, setKind] = useState("SCHOOL_REPORT"), [title, setTitle] = useState("");
  const sid = who || kids.data?.[0]?.id;
  const docs = useResource<any[]>(sid ? `/me/students/${sid}/credentials` : null);
  const { busy, msg, run } = useBusy();
  return (
    <Screen>
      <Loading error={kids.error} loading={kids.loading && !kids.data} />
      {(kids.data?.length ?? 0) > 1 && <Select label={t("fam.forWhom")} value={sid ?? ""} onChange={setWho} required options={kids.data!.map((k): [string, string] => [k.id, k.fullName])} />}
      <Card title={t("common.upload")}>
        <Select label={t("fam.docKind")} value={kind} onChange={setKind} required options={DOC_KINDS.map((k): [string, string] => [k, t(`dockind.${k}`)])} />
        <Field label={t("fam.docTitle")} value={title} onChange={setTitle} maxLength={120} />
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
        <Btn testID="photo" label={t("m.photo")} busy={busy} disabled={!sid} onPress={() => run(async () => {
          const f = await pickPhoto(); if (!f || !sid) return;
          await uploadPicked(`/me/students/${sid}/credentials/upload-url`, `/me/students/${sid}/credentials`, f, { kind, title: title || t(`dockind.${kind}`) });
          setTitle(""); docs.reload();
        }, t("common.saved"))} />
        <Btn testID="pick" kind="ghost" label={busy ? t("common.uploading") : t("m.chooseFileOrPhoto")} busy={busy} disabled={!sid} onPress={() => run(async () => {
          const f = await pickFile(); if (!f || !sid) return;
          await uploadPicked(`/me/students/${sid}/credentials/upload-url`, `/me/students/${sid}/credentials`, f, { kind, title: title || t(`dockind.${kind}`) });
          setTitle(""); docs.reload();
        }, t("common.saved"))} />
      </Card>
      <Loading error={docs.error} loading={docs.loading && !docs.data} />
      {docs.data?.length === 0 && <Empty />}
      {docs.data?.map((d) => (
        <Card key={d.id}><P style={{ fontWeight: "700" }}>{d.title}</P><P muted>{t(`dockind.${d.kind}`)} · {dt(d.createdAt)}</P>
          <Btn kind="ghost" label={t("common.view")} onPress={async () => Linking.openURL((await api(`/me/credentials/${d.id}/download`)).url)} /></Card>
      ))}
    </Screen>
  );
}
