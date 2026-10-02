"use client";
import Link from "next/link";
import { Logo } from "./Icon";
import { LanguageSwitcher, useT } from "@/lib/i18n";

// The one header used by the landing page, sign-in pages and the signed-in app, so the product feels like a single institution site.
export function SiteHeader({ children, onLang }: { children?: React.ReactNode; onLang?: (l: any) => void }) {
  const { t } = useT();
  return (
    <header className="site">
      <a className="skip" href="#main">{t("nav.skip")}</a>
      <div className="in">
        <Link className="brand" href="/" aria-label={t("common.appName")}>
          <Logo />
          <span><span className="name">{t("common.appName")}</span><span className="tag">{t("brand.tagline")}</span></span>
        </Link>
        <div className="ctl"><LanguageSwitcher onChange={onLang} />{children}</div>
      </div>
    </header>
  );
}
