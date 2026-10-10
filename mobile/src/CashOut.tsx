import { Text } from "react-native";
import { useT } from "./i18n";
import { C, P } from "./ui";

// Where to pay: applicants "cash out" at an agent. Shows the agent code and name (the number is only a fallback).
export function CashOut({ info, provider }: { info: any; provider: string }) {
  const { t } = useT();
  const a = info?.agents?.[provider];
  return (
    <>
      <P muted>{t("fam.cashOutTo")}</P>
      {a?.code ? <>
        <Text selectable accessibilityLabel={t("fam.agentCode")} style={{ fontSize: 28, fontWeight: "700", color: C.navy }}>{a.code}</Text>
        {a.name ? <Text selectable style={{ fontSize: 17, fontWeight: "600", color: C.ink, marginBottom: 12 }}>{t("fam.agentName")}: {a.name}</Text> : null}
      </> : <Text selectable style={{ fontSize: 24, fontWeight: "700", color: C.navy, marginBottom: 12 }}>{info?.[provider] ?? "—"}</Text>}
    </>
  );
}
