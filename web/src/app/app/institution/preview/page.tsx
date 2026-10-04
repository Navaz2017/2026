"use client";
import Link from "next/link";
import { SchoolView } from "@/components/SchoolView";
import { useT } from "@/lib/i18n";
import { Loading, Msg, Page, useLoad } from "@/lib/ui";

// The school sees its own public page exactly as applicants will, including media still hidden until verification.
export default function Preview() {
  const { t } = useT();
  const { data, error, loading } = useLoad<any>("/institution/preview");
  return (
    <Page title={t("sch.preview")} actions={<Link href="/app/institution/media">← {t("nav.gallery")}</Link>}>
      <Msg kind="info">{t("sch.previewNote")}</Msg>
      <Loading error={error} loading={loading} />
      {data && <SchoolView s={data} preview />}
    </Page>
  );
}
