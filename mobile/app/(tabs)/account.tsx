import { useRouter } from "expo-router";
import { useT } from "../../src/i18n";
import { useSession } from "../../src/session";
import { Btn, Card, H2, LanguagePicker, P, Screen } from "../../src/ui";

export default function Account() {
  const { t, lang } = useT();
  const { user, signOut, changeLanguage } = useSession();
  const router = useRouter();
  return (
    <Screen>
      <Card><H2>{user?.fullName}</H2><P muted>{[user?.phone, user?.email].filter(Boolean).join(" · ")}</P></Card>
      <Card title={t("common.language")}><LanguagePicker value={lang} onChange={changeLanguage} /></Card>
      <Card>
        {user?.role === "PARENT" && <Btn kind="ghost" testID="children" label={t("nav.children")} onPress={() => router.push("/children")} />}
        <Btn kind="ghost" testID="documents" label={t("nav.myDocs")} onPress={() => router.push("/documents")} />
        <Btn kind="ghost" testID="password" label={t("sec.changeTitle")} onPress={() => router.push("/password")} />
      </Card>
      <Btn testID="signout" kind="danger" label={t("auth.signOut")} onPress={signOut} />
    </Screen>
  );
}
