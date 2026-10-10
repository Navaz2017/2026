"use client";
import { useT } from "@/lib/i18n";
import { dt } from "@/lib/ui";

const Row = ({ k, v }: { k: string; v: any }) => (v === undefined || v === null || v === "" ? null : <div className="srow"><span className="muted">{k}</span><span>{v}</span></div>);

// Read-only view of a submitted/draft application form. Used by the applicant's review step and the institution's applicant file.
export function FormSummary({ form, onEdit }: { form: any; onEdit?: (step: string) => void }) {
  const { t } = useT();
  const f = form ?? {};
  const Sec = ({ title, step, children }: { title: string; step: string; children: React.ReactNode }) => (
    <section className="sumsec"><div className="row" style={{ justifyContent: "space-between" }}><h3>{title}</h3>{onEdit && <button type="button" className="linkbtn" onClick={() => onEdit(step)}>{t("common.edit")}</button>}</div>{children}</section>
  );
  const p = f.personal, e = f.education, g = f.guardian, s = f.study, sp = f.sponsor, st = f.status;
  return (
    <div>
      {p && <Sec title={t("step.personal")} step="personal">
        <Row k={t("auth.fullName")} v={[p.firstName, p.middleName, p.surname].filter(Boolean).join(" ")} />
        <Row k={t("p.gender")} v={p.gender === "M" ? t("p.male") : p.gender === "F" ? t("p.female") : ""} /><Row k={t("p.dob")} v={dt(p.dateOfBirth)} />
        <Row k={t("p.nationality")} v={p.nationality} /><Row k={t("p.nationalId")} v={p.nationalId} />
        <Row k={t("p.homeDistrict")} v={[p.homeDistrict, p.village].filter(Boolean).join(" · ")} />
        <Row k={t("p.address")} v={p.physicalAddress} /><Row k={t("p.phone")} v={p.phone} /><Row k={t("p.email")} v={p.email} />
        {f.specialNeeds?.hasDisability && <Row k={t("sn.title")} v={[f.specialNeeds.details, f.specialNeeds.assistance].filter(Boolean).join(" — ")} />}
      </Sec>}
      {e && <Sec title={t("step.education")} step="education">
        <Row k={t("ed.level")} v={e.level && t(`qual.${e.level}`)} /><Row k={t("ed.school")} v={e.schoolName} /><Row k={t("ed.year")} v={e.year} /><Row k={t("ed.points")} v={e.totalPoints} />
        <Row k={t("ed.prevSchool")} v={e.previousSchoolName} /><Row k={t("ed.lastClass")} v={e.lastClassCompleted} />
        {e.requestGrades && <Row k={t("ed.requestGrades")} v={t("common.yes")} />}
        {e.subjects?.length > 0 && <div className="tblwrap"><table className="tbl"><thead><tr><th>{t("ed.subject")}</th><th>{t("ed.grade")}</th></tr></thead><tbody>{e.subjects.map((x: any, i: number) => <tr key={i}><td>{x.subject}</td><td>{x.grade}</td></tr>)}</tbody></table></div>}
        {e.otherQualifications?.map((q: any, i: number) => <Row key={i} k={t(`oq.${q.type}`)} v={`${q.institution}, ${q.year}`} />)}
      </Sec>}
      {f.payment && onEdit && <Sec title={t("step.payment")} step="payment"><Row k={t("fam.provider")} v={t(`provider.${f.payment.provider}`)} /><Row k={t("fam.reference")} v={f.payment.reference} /></Sec>}
      {st && <Sec title={t("step.status")} step="status"><Row k={t("st.current")} v={t(`cur.${st.current}`)} /><Row k={t("st.employer")} v={st.employer} /><Row k={t("st.position")} v={st.position} /></Sec>}
      {g && <Sec title={t("step.guardian")} step="guardian"><Row k={t(`rel.${g.relationship}`)} v={g.name} /><Row k={t("g.phone")} v={g.phone} /><Row k={t("g.email")} v={g.email} /><Row k={t("g.occupation")} v={g.occupation} /></Sec>}
      {s && <Sec title={t("step.study")} step="study"><Row k={t("sy.mode")} v={s.mode && t(`mode.${s.mode}`)} /><Row k={t("sy.campus")} v={s.campus} /><Row k={t("sy.entry")} v={s.entryLevel} /></Sec>}
      {sp && <Sec title={t("step.sponsor")} step="sponsor"><Row k={t("sp.type")} v={t(`spt.${sp.type}`)} /><Row k={t("sp.name")} v={sp.name} /><Row k={t("sp.phone")} v={sp.phone} />{f.heardAbout?.channels?.length > 0 && <Row k={t("heard.title").replace(/ \(.*\)/, "")} v={f.heardAbout.channels.map((c: string) => t(`heard.${c}`)).join(", ")} />}</Sec>}
    </div>
  );
}
