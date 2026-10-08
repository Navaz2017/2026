import { useLocalSearchParams, useRouter } from "expo-router";
import { SchoolView } from "../../src/school";
import { useResource } from "../../src/offline";
import { Loading, Msg, Screen } from "../../src/ui";
import { useT } from "../../src/i18n";

export default function School() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useT();
  const s = useResource<any>(`/public/institutions/${id}`);
  return (
    <Screen>
      <Loading error={s.error} loading={s.loading && !s.data} />
      {s.offline && s.data ? <Msg kind="info">{t("common.offline")}</Msg> : null}
      {s.data && <SchoolView s={s.data} onApply={(pid) => router.push(`/start/${pid}`)} />}
    </Screen>
  );
}
