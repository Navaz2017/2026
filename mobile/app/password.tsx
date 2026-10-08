import { useState } from "react";
import { post, storeTokens } from "../src/api";
import { useT } from "../src/i18n";
import { Btn, Card, Field, Msg, Screen, useBusy } from "../src/ui";

export default function Password() {
  const { t } = useT();
  const { busy, msg, run } = useBusy();
  const [cur, setCur] = useState(""), [nw, setNw] = useState("");
  return (
    <Screen>
      <Card>
        <Field testID="current" label={t("sec.current")} value={cur} onChange={setCur} secureTextEntry autoComplete="current-password" />
        <Field testID="new" label={t("sec.new")} hint={t("auth.passwordHelp")} value={nw} onChange={setNw} secureTextEntry autoComplete="new-password" />
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
        <Btn testID="submit" label={t("common.save")} busy={busy} disabled={!cur || nw.length < 10} onPress={() => run(async () => { const r = await post("/auth/change-password", { currentPassword: cur, newPassword: nw }); await storeTokens(r.accessToken, r.refreshToken); setCur(""); setNw(""); }, t("sec.changed"))} />
      </Card>
    </Screen>
  );
}
