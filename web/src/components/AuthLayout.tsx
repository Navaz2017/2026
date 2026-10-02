"use client";
import { Icon } from "./Icon";
import { SiteHeader } from "./SiteHeader";
import { useT } from "@/lib/i18n";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  return (
    <>
      <SiteHeader />
      <div className="authgrid">
        <aside className="authpanel">
          <h2>{t("auth.panelTitle")}</h2>
          <ul>{["auth.panel1", "auth.panel2", "auth.panel3"].map((k) => <li key={k}><Icon name="check" size={20} /><span>{t(k)}</span></li>)}</ul>
        </aside>
        <main id="main" className="authform">{children}</main>
      </div>
    </>
  );
}
