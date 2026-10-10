"use client";
import { useT } from "@/lib/i18n";

// Where to pay: applicants "cash out" at an agent. Shows the agent code and name (the number is only a fallback).
export function CashOut({ info, provider }: { info: any; provider: string }) {
  const { t } = useT();
  const a = info?.agents?.[provider];
  return (
    <div>
      <div className="muted">{t("fam.cashOutTo")}</div>
      {a?.code ? <>
        <div className="mono" style={{ fontSize: "1.5rem", fontWeight: 700 }} aria-label={t("fam.agentCode")}>{a.code}</div>
        {a.name && <div style={{ fontWeight: 600 }}>{t("fam.agentName")}: {a.name}</div>}
      </> : <div className="mono" style={{ fontSize: "1.3rem", fontWeight: 700 }}>{info?.[provider] ?? "—"}</div>}
    </div>
  );
}
