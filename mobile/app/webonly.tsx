import { Redirect } from "expo-router";
import { useT } from "../src/i18n";
import { isFamily, useSession } from "../src/session";
import { Btn, Card, LanguagePicker, Msg, P, Screen } from "../src/ui";

// Institutions and the platform owner manage everything on the website; this app is for parents and students.
export default function WebOnly() {
  const { t, lang } = useT();
  const { user, signOut, changeLanguage } = useSession();
  if (!user) return <Redirect href="/login" />;
  if (isFamily(user.role)) return <Redirect href="/" />;
  return (
    <Screen>
      <Card><Msg kind="info">{t("m.webOnly")}</Msg><P>{user.fullName}</P><LanguagePicker value={lang} onChange={changeLanguage} /><Btn kind="ghost" label={t("auth.signOut")} onPress={signOut} /></Card>
    </Screen>
  );
}
