"use client";
import Link from "next/link";
import { MediaGallery } from "./MediaGallery";
import { levelLabel } from "@/lib/forms";
import { useT } from "@/lib/i18n";
import { Badge, Card, mk, dt } from "@/lib/ui";

export const tuitionText = (t: (k: string, v?: any) => string, p: { tuitionFeeMinor: number; tuitionPeriod: string }) =>
  p.tuitionFeeMinor > 0 ? `${mk(p.tuitionFeeMinor)} ${t(`period.${p.tuitionPeriod}`)}` : "—";

export function ProgramFacts({ p }: { p: any }) {
  const { t } = useT();
  return (
    <div className="muted">
      <div><strong>{t("prog.tuition")}:</strong> {tuitionText(t, p)}{p.duration ? ` · ${t("prog.duration")}: ${p.duration}` : ""}</div>
      {p.modes?.length > 0 && <div>{t("prog.modes")}: {p.modes.map((m: string) => t(`mode.${m}`)).join(", ")}</div>}
      {p.entryRequirements && <div>{t("prog.entry")}: {p.entryRequirements}</div>}
    </div>
  );
}

// Everything an applicant sees about a school. Used by the public page and by the school's own preview.
export function SchoolView({ s, applyHref, preview }: { s: any; applyHref?: (programId: string) => string; preview?: boolean }) {
  const { t } = useT();
  const school = s.type === "PRIMARY_SCHOOL" || s.type === "SECONDARY_SCHOOL";
  return (
    <div>
      <div className="schoolhead">
        <span className="badge neutral">{t(`type.${s.type}`)}</span>
        <h1 style={{ marginTop: ".5rem" }}>{s.name}</h1>
        <div className="muted">{[s.district, s.address].filter(Boolean).join(" · ")}</div>
        {preview && <div style={{ marginTop: ".5rem" }}><Badge ns="st.inst" value={s.status} /></div>}
      </div>
      {s.description && <Card title={t("sch.about")}><p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{s.description}</p></Card>}
      <Card>
        <div className="grid two">
          {school && s.highestLevel && <div><span className="muted">{t("sch.highest")}</span><div><strong>{levelLabel(s.highestLevel)}</strong>{s.syllabi?.length ? ` · ${s.syllabi.join(" / ")}` : ""}</div></div>}
          {s.campuses?.length > 0 && <div><span className="muted">{t("sch.campuses")}</span><div><strong>{s.campuses.join(", ")}</strong></div></div>}
          {s.website && <div><span className="muted">{t("sch.website")}</span><div><a href={s.website} target="_blank" rel="noopener noreferrer">{s.website}</a></div></div>}
          {(s.contactPhone || s.contactEmail) && <div><span className="muted">{t("auth.contactEmail")}</span><div>{[s.contactPhone, s.contactEmail].filter(Boolean).join(" · ")}</div></div>}
        </div>
      </Card>
      <Card title={school ? t("sch.classes") : t("sch.programmes")}>
        {s.programs.length === 0 && <p className="muted">{t("common.none")}</p>}
        {s.programs.map((p: any) => (
          <div key={p.id} className="progrow">
            <div>
              <strong>{p.title}</strong>{p.code ? <span className="muted"> · {p.code}</span> : null}
              <ProgramFacts p={p} />
              <div className="muted">{t("fam.totalFee")}: <strong>{mk(p.totalDueMinor)}</strong> · {t("fam.seatsLeft", { n: Math.max(0, p.seats - p.seatsTaken) })}{p.closesAt ? ` · ${t("fam.closesOn", { date: dt(p.closesAt) })}` : ""}</div>
            </div>
            {applyHref && <Link className="btn primary" href={applyHref(p.id)}>{t("fam.apply")}</Link>}
          </div>
        ))}
      </Card>
      {Array.isArray(s.otherFees) && s.otherFees.length > 0 && (
        <Card title={t("sch.otherFees")}>{s.otherFees.map((f: any, i: number) => <div key={i} className="srow"><span>{f.name}</span><span>{mk(f.amountMinor)} {t(`period.${f.period}`)}</span></div>)}</Card>
      )}
      <Card title={t("sch.gallery")}>
        {s.media.length === 0 ? <p className="muted">{t("sch.noMedia")}</p> : <MediaGallery items={s.media} showStatus={preview} />}
      </Card>
    </div>
  );
}
