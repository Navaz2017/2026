"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, post, put, uploadFile } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Btn, Card, Field, Loading, Msg, mk, useBusy, useErr, useLoad } from "@/lib/ui";
import { Area, Check, Sel, Txt, clean, useFields } from "@/components/Fields";
import { FormSummary } from "@/components/FormSummary";
import { ProgramFacts } from "@/components/SchoolView";
import { Icon } from "@/components/Icon";
import { ACADEMIC_KINDS, DOC_KINDS, HEARD, MODES, OTHER_QUALS, QUALS, isSchool, levelLabel } from "@/lib/forms";

type Step = "programmes" | "personal" | "education" | "status" | "guardian" | "study" | "sponsor" | "documents" | "review";
const STEPS_COLLEGE: Step[] = ["programmes", "personal", "education", "status", "guardian", "study", "sponsor", "documents", "review"];
const STEPS_SCHOOL: Step[] = ["programmes", "personal", "education", "guardian", "documents", "review"];

interface Ctx { app: any; reload: () => Promise<void>; next: () => void; back: () => void; first: boolean; school: boolean; goto: (s: string) => void; exit: () => void }

const Nav = ({ busy, back, first, exit, nextLabel }: { busy: boolean; back: () => void; first: boolean; exit?: () => void; nextLabel?: string }) => {
  const { t } = useT();
  return (
    <div className="row" style={{ marginTop: "1rem", justifyContent: "space-between" }}>
      <div className="row">{!first && <Btn type="button" kind="ghost" onClick={back}>{t("wiz.back")}</Btn>}{exit && <button type="button" className="linkbtn" onClick={exit}>{t("wiz.saveExit")}</button>}</div>
      <Btn kind="primary" busy={busy}>{nextLabel ?? t("wiz.next")}<Icon name="arrow" size={18} /></Btn>
    </div>
  );
};

// ---------------------------------------------------------------- programmes / class
function Programmes({ c }: { c: Ctx }) {
  const { t } = useT();
  const { app } = c;
  const school = c.school, max: number = app.maxChoices;
  const page = useLoad<any>(`/public/institutions/${app.institution.id}`);
  const [ids, setIds] = useState<string[]>(app.choices.map((x: any) => x.program.id));
  const { busy, msg, run } = useBusy();
  const programs: any[] = page.data?.programs ?? [];
  const byId = (id: string) => programs.find((p) => p.id === id) ?? app.choices.find((x: any) => x.program.id === id)?.program;
  const open = programs.filter((p) => p.seats - p.seatsTaken > 0);
  const move = (i: number, d: number) => { const a = [...ids]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j]!, a[i]!]; setIds(a); };

  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => { await put(`/me/applications/${app.id}/choices`, { programIds: ids }); await c.reload(); c.next(); }); }}>
      <p>{school ? t("wiz.chooseClass") : t("wiz.choose", { max, name: app.institution.name })}</p>
      <Loading error={page.error} loading={page.loading} />
      {school ? (
        <div>{open.map((p) => (
          <label key={p.id} className="choice" style={{ cursor: "pointer", borderColor: ids[0] === p.id ? "var(--navy)" : undefined }}>
            <input type="radio" name="cls" checked={ids[0] === p.id} onChange={() => setIds([p.id])} style={{ width: 22, height: 22, minHeight: 0 }} />
            <div><strong>{p.title}</strong><ProgramFacts p={p} /></div>
          </label>
        ))}</div>
      ) : (
        <>
          {ids.map((id, i) => { const p = byId(id); return (
            <div key={id} className="choice">
              <div className="rank">{i + 1}</div>
              <div style={{ flex: 1 }}><strong>{p?.title}</strong>{p?.code ? <span className="muted"> · {p.code}</span> : null}{p && <ProgramFacts p={p} />}</div>
              <div className="row">
                {i > 0 && <button type="button" className="linkbtn" onClick={() => move(i, -1)}>{t("wiz.moveUp")}</button>}
                {ids.length > 1 && <button type="button" className="linkbtn" onClick={() => setIds(ids.filter((x) => x !== id))}>{t("wiz.remove")}</button>}
              </div>
            </div>
          ); })}
          {ids.length < max
            ? (open.filter((p) => !ids.includes(p.id)).length > 0
              ? <Sel label={t("wiz.addChoice")} value="" onChange={(v) => v && setIds([...ids, v])} options={open.filter((p) => !ids.includes(p.id)).map((p) => [p.id, p.title])} />
              : <p className="muted">{t("wiz.noMore")}</p>)
            : <Msg kind="info">{t("wiz.maxReached", { max })}</Msg>}
        </>
      )}
      <Msg kind="info">{t("prog.feeNote")} <strong>{t("fam.totalToPay")}: {mk(app.totalDueMinor)}</strong></Msg>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Nav busy={busy} back={c.back} first />
    </form>
  );
}

// ---------------------------------------------------------------- personal (+ special needs)
function Personal({ c }: { c: Ctx }) {
  const { t } = useT();
  const { user } = useSession();
  const { app } = c;
  const prof = app.form?.personal ?? app.student.profile ?? {};
  const parts = (app.student.fullName ?? "").split(" ");
  const epoch = String(app.student.dateOfBirth).startsWith("1970");
  const { v, set } = useFields<any>({ surname: prof.surname ?? (parts.length > 1 ? parts[parts.length - 1] : ""), firstName: prof.firstName ?? parts[0] ?? "", middleName: prof.middleName ?? "", gender: prof.gender ?? "", dateOfBirth: (prof.dateOfBirth ?? (epoch ? "" : app.student.dateOfBirth) ?? "").slice(0, 10), nationality: prof.nationality ?? "Malawian", nationalId: prof.nationalId ?? "", homeDistrict: prof.homeDistrict ?? "", traditionalAuthority: prof.traditionalAuthority ?? "", village: prof.village ?? "", religion: prof.religion ?? "", physicalAddress: prof.physicalAddress ?? "", postalAddress: prof.postalAddress ?? "", phone: prof.phone ?? "", email: prof.email ?? (user?.role === "STUDENT" ? user.email : "") });
  const sn = useFields<any>({ hasDisability: app.form?.specialNeeds?.hasDisability ?? false, details: app.form?.specialNeeds?.details ?? "", assistance: app.form?.specialNeeds?.assistance ?? "" });
  const { busy, msg, run } = useBusy();
  const save = async (partial = false) => {
    const q = partial ? "?partial=1" : "";
    await put(`/me/applications/${app.id}/section/personal${q}`, clean(v));
    await put(`/me/applications/${app.id}/section/specialNeeds${q}`, clean({ ...sn.v, details: sn.v.hasDisability ? sn.v.details : "", assistance: sn.v.hasDisability ? sn.v.assistance : "" }));
    await c.reload();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => { await save(); c.next(); }); }}>
      <div className="grid two">
        <Txt label={t("p.surname")} required value={v.surname} onChange={(x) => set("surname", x)} />
        <Txt label={t("p.firstName")} required value={v.firstName} onChange={(x) => set("firstName", x)} />
        <Txt label={t("p.middleName")} value={v.middleName} onChange={(x) => set("middleName", x)} />
        <Sel label={t("p.gender")} required value={v.gender} onChange={(x) => set("gender", x)} options={[["M", t("p.male")], ["F", t("p.female")]]} />
        <Txt label={t("p.dob")} type="date" required value={v.dateOfBirth} onChange={(x) => set("dateOfBirth", x)} />
        <Txt label={t("p.nationality")} required value={v.nationality} onChange={(x) => set("nationality", x)} />
        <Txt label={t("p.nationalId")} value={v.nationalId} onChange={(x) => set("nationalId", x)} />
        <Txt label={t("p.homeDistrict")} required value={v.homeDistrict} onChange={(x) => set("homeDistrict", x)} />
        <Txt label={t("p.ta")} value={v.traditionalAuthority} onChange={(x) => set("traditionalAuthority", x)} />
        <Txt label={t("p.village")} value={v.village} onChange={(x) => set("village", x)} />
        <Txt label={t("p.address")} required value={v.physicalAddress} onChange={(x) => set("physicalAddress", x)} />
        <Txt label={t("p.postal")} value={v.postalAddress} onChange={(x) => set("postalAddress", x)} />
        <Txt label={t("p.phone")} required type="tel" inputMode="tel" value={v.phone} onChange={(x) => set("phone", x)} />
        <Txt label={t("p.email")} type="email" value={v.email} onChange={(x) => set("email", x)} />
      </div>
      <Txt label={t("p.religion")} value={v.religion} onChange={(x) => set("religion", x)} />
      <h2 style={{ marginTop: "1rem" }}>{t("sn.title")}</h2>
      <Sel label={t("sn.has")} required value={sn.v.hasDisability ? "Y" : "N"} onChange={(x) => sn.set("hasDisability", x === "Y")} options={[["N", t("common.no")], ["Y", t("common.yes")]]} />
      {sn.v.hasDisability && <><Area label={t("sn.details")} value={sn.v.details} onChange={(x) => sn.set("details", x)} maxLength={500} /><Area label={t("sn.assist")} value={sn.v.assistance} onChange={(x) => sn.set("assistance", x)} maxLength={500} /></>}
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Nav busy={busy} back={c.back} first={false} exit={() => run(async () => { await save(true); c.exit(); })} />
    </form>
  );
}

// ---------------------------------------------------------------- education
function Education({ c }: { c: Ctx }) {
  const { t } = useT();
  const { app } = c;
  const e0 = app.form?.education ?? {};
  const first = app.choices[0]?.program;
  const std1 = c.school && first?.classLevel === "STD1";
  const { v, set } = useFields<any>({ level: e0.level ?? "", schoolName: e0.schoolName ?? "", year: e0.year ?? "", centreNumber: e0.centreNumber ?? "", candidateNumber: e0.candidateNumber ?? "", totalPoints: e0.totalPoints ?? "", resitYears: e0.resitYears ?? "", previousSchoolId: e0.previousSchoolId ?? "", previousSchoolName: e0.previousSchoolName ?? "", lastClassCompleted: e0.lastClassCompleted ?? "", requestGrades: e0.requestGrades ?? false, disciplinedYes: e0.disciplined?.yes ?? false, disciplinedDetails: e0.disciplined?.details ?? "" });
  const [subjects, setSubjects] = useState<{ subject: string; grade: string }[]>(e0.subjects?.length ? e0.subjects : [{ subject: "", grade: "" }]);
  const [others, setOthers] = useState<any[]>(e0.otherQualifications ?? []);
  const schools = useLoad<any[]>(c.school ? "/public/institutions" : null);
  const { busy, msg, run } = useBusy();
  const body = () => clean({
    ...v, year: v.year ? Number(v.year) : undefined, totalPoints: v.totalPoints !== "" ? Number(v.totalPoints) : undefined, previousSchoolId: v.previousSchoolId || undefined,
    requestGrades: v.previousSchoolId ? !!v.requestGrades : false, subjects: subjects.filter((s) => s.subject && s.grade), otherQualifications: others.filter((o) => o.institution && o.year).map((o) => ({ ...o, year: Number(o.year) })),
    disciplined: c.school ? undefined : { yes: !!v.disciplinedYes, details: v.disciplinedYes ? v.disciplinedDetails : undefined }, disciplinedYes: undefined, disciplinedDetails: undefined,
  });
  const save = async (partial = false) => { await put(`/me/applications/${app.id}/section/education${partial ? "?partial=1" : ""}`, body()); await c.reload(); };

  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => { await save(); c.next(); }); }}>
      {c.school ? (
        <>
          {std1 && <Msg kind="info">{t("ed.std1")}</Msg>}
          <Sel label={t("ed.prevOnPlatform")} value={v.previousSchoolId} blank onChange={(x) => { set("previousSchoolId", x); const s = schools.data?.find((y) => y.id === x); if (s) set("previousSchoolName", s.name); }} options={(schools.data ?? []).filter((s) => s.id !== app.institution.id).map((s) => [s.id, s.name])} />
          <Txt label={t("ed.prevName")} required={!std1 && !v.previousSchoolId} value={v.previousSchoolName} onChange={(x) => set("previousSchoolName", x)} />
          <Txt label={t("ed.lastClass")} value={v.lastClassCompleted} onChange={(x) => set("lastClassCompleted", x)} />
          {v.previousSchoolId && <><Check label={t("ed.requestGrades")} checked={v.requestGrades} onChange={(x) => set("requestGrades", x)} /><p className="muted" style={{ marginTop: 0 }}>{t("ed.requestGradesHelp")}</p></>}
        </>
      ) : (
        <>
          <div className="grid two">
            <Sel label={t("ed.level")} required value={v.level} onChange={(x) => set("level", x)} options={QUALS.map((q) => [q, t(`qual.${q}`)])} />
            <Txt label={t("ed.school")} required value={v.schoolName} onChange={(x) => set("schoolName", x)} />
            <Txt label={t("ed.year")} required type="number" min={1950} max={2100} value={v.year} onChange={(x) => set("year", x)} />
            <Txt label={t("ed.points")} type="number" value={v.totalPoints} onChange={(x) => set("totalPoints", x)} />
            <Txt label={t("ed.centre")} value={v.centreNumber} onChange={(x) => set("centreNumber", x)} />
            <Txt label={t("ed.candidate")} value={v.candidateNumber} onChange={(x) => set("candidateNumber", x)} />
          </div>
          <h2>{t("ed.subjects")}</h2>
          {subjects.map((s, i) => (
            <div key={i} className="subjrow">
              <Txt label={t("ed.subject")} value={s.subject} onChange={(x) => setSubjects(subjects.map((y, j) => (j === i ? { ...y, subject: x } : y)))} />
              <Txt label={t("ed.grade")} value={s.grade} onChange={(x) => setSubjects(subjects.map((y, j) => (j === i ? { ...y, grade: x } : y)))} maxLength={10} />
              {subjects.length > 1 && <button type="button" className="linkbtn" style={{ marginBottom: ".9rem" }} onClick={() => setSubjects(subjects.filter((_, j) => j !== i))}>{t("wiz.remove")}</button>}
            </div>
          ))}
          {subjects.length < 12 && <Btn type="button" kind="ghost" onClick={() => setSubjects([...subjects, { subject: "", grade: "" }])}>{t("ed.addSubject")}</Btn>}
          <Txt label={t("ed.resit")} value={v.resitYears} onChange={(x) => set("resitYears", x)} />
          <h2 style={{ marginTop: "1rem" }}>{t("ed.other")}</h2>
          {others.map((o, i) => (
            <div key={i} className="grid two">
              <Sel label={t("ed.other")} required value={o.type} onChange={(x) => setOthers(others.map((y, j) => (j === i ? { ...y, type: x } : y)))} options={OTHER_QUALS.map((q) => [q, t(`oq.${q}`)])} />
              <Txt label={t("ed.institution")} required value={o.institution} onChange={(x) => setOthers(others.map((y, j) => (j === i ? { ...y, institution: x } : y)))} />
              <Txt label={t("ed.year")} required type="number" value={o.year} onChange={(x) => setOthers(others.map((y, j) => (j === i ? { ...y, year: x } : y)))} />
              <button type="button" className="linkbtn" onClick={() => setOthers(others.filter((_, j) => j !== i))}>{t("wiz.remove")}</button>
            </div>
          ))}
          {others.length < 5 && <Btn type="button" kind="ghost" onClick={() => setOthers([...others, { type: "DIPLOMA", institution: "", year: "" }])}>{t("ed.addOther")}</Btn>}
          <Sel label={t("ed.disciplined")} required value={v.disciplinedYes ? "Y" : "N"} onChange={(x) => set("disciplinedYes", x === "Y")} options={[["N", t("common.no")], ["Y", t("common.yes")]]} />
          {v.disciplinedYes && <Area label={t("ed.disciplinedDetails")} value={v.disciplinedDetails} onChange={(x) => set("disciplinedDetails", x)} maxLength={300} />}
        </>
      )}
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Nav busy={busy} back={c.back} first={false} exit={() => run(async () => { await save(true); c.exit(); })} />
    </form>
  );
}

// ---------------------------------------------------------------- current status (colleges)
function Status({ c }: { c: Ctx }) {
  const { t } = useT();
  const s0 = c.app.form?.status ?? {};
  const { v, set } = useFields<any>({ current: s0.current ?? "", employer: s0.employer ?? "", position: s0.position ?? "", workExperienceYears: s0.workExperienceYears ?? "" });
  const { busy, msg, run } = useBusy();
  const work = v.current === "EMPLOYED" || v.current === "SELF_EMPLOYED";
  const save = async (partial = false) => { await put(`/me/applications/${c.app.id}/section/status${partial ? "?partial=1" : ""}`, clean({ ...v, employer: work ? v.employer : "", position: work ? v.position : "", workExperienceYears: v.workExperienceYears !== "" ? Number(v.workExperienceYears) : undefined })); await c.reload(); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => { await save(); c.next(); }); }}>
      <Sel label={t("st.current")} required value={v.current} onChange={(x) => set("current", x)} options={["EMPLOYED", "SELF_EMPLOYED", "UNEMPLOYED", "STUDYING"].map((k) => [k, t(`cur.${k}`)])} />
      {work && <div className="grid two"><Txt label={t("st.employer")} value={v.employer} onChange={(x) => set("employer", x)} /><Txt label={t("st.position")} value={v.position} onChange={(x) => set("position", x)} /></div>}
      <Txt label={t("st.experience")} type="number" min={0} max={60} value={v.workExperienceYears} onChange={(x) => set("workExperienceYears", x)} />
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Nav busy={busy} back={c.back} first={false} exit={() => run(async () => { await save(true); c.exit(); })} />
    </form>
  );
}

// ---------------------------------------------------------------- parent / guardian
function Guardian({ c }: { c: Ctx }) {
  const { t } = useT();
  const par = c.app.student.parent;
  const g0 = c.app.form?.guardian ?? (par ? { relationship: "PARENT", name: par.user.fullName, phone: par.user.phone ?? "", email: par.user.email, occupation: par.occupation } : {});
  const { v, set } = useFields<any>({ relationship: g0.relationship ?? "PARENT", name: g0.name ?? "", phone: g0.phone ?? "", email: g0.email ?? "", address: g0.address ?? "", village: g0.village ?? "", district: g0.district ?? "", occupation: g0.occupation ?? "" });
  const { busy, msg, run } = useBusy();
  const save = async (partial = false) => { await put(`/me/applications/${c.app.id}/section/guardian${partial ? "?partial=1" : ""}`, clean(v)); await c.reload(); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => { await save(); c.next(); }); }}>
      <div className="grid two">
        <Sel label={t("g.relationship")} required value={v.relationship} onChange={(x) => set("relationship", x)} options={["PARENT", "GUARDIAN", "NEXT_OF_KIN"].map((k) => [k, t(`rel.${k}`)])} />
        <Txt label={t("g.name")} required value={v.name} onChange={(x) => set("name", x)} />
        <Txt label={t("g.phone")} required type="tel" inputMode="tel" value={v.phone} onChange={(x) => set("phone", x)} />
        <Txt label={t("g.email")} type="email" value={v.email} onChange={(x) => set("email", x)} />
        <Txt label={t("g.occupation")} value={v.occupation} onChange={(x) => set("occupation", x)} />
        <Txt label={t("g.address")} value={v.address} onChange={(x) => set("address", x)} />
        <Txt label={t("g.village")} value={v.village} onChange={(x) => set("village", x)} />
        <Txt label={t("g.district")} value={v.district} onChange={(x) => set("district", x)} />
      </div>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Nav busy={busy} back={c.back} first={false} exit={() => run(async () => { await save(true); c.exit(); })} />
    </form>
  );
}

// ---------------------------------------------------------------- study options (colleges)
function Study({ c }: { c: Ctx }) {
  const { t } = useT();
  const { app } = c;
  const s0 = app.form?.study ?? {};
  const offered: string[] = [...new Set<string>(app.choices.flatMap((x: any) => x.program.modes as string[]))];
  const modes = offered.length ? offered : MODES;
  const { v, set } = useFields<any>({ mode: s0.mode ?? (modes.length === 1 ? modes[0] : ""), campus: s0.campus ?? (app.institution.campuses.length === 1 ? app.institution.campuses[0] : ""), entryLevel: s0.entryLevel ?? "", redirect: s0.redirect ?? false });
  const { busy, msg, run } = useBusy();
  const save = async (partial = false) => { await put(`/me/applications/${app.id}/section/study${partial ? "?partial=1" : ""}`, clean({ ...v, redirect: !!v.redirect })); await c.reload(); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => { await save(); c.next(); }); }}>
      <div className="grid two">
        <Sel label={t("sy.mode")} required value={v.mode} onChange={(x) => set("mode", x)} options={modes.map((m) => [m, t(`mode.${m}`)])} />
        {app.institution.campuses.length > 0 && <Sel label={t("sy.campus")} required value={v.campus} onChange={(x) => set("campus", x)} options={app.institution.campuses.map((x: string) => [x, x])} />}
        <Txt label={t("sy.entry")} value={v.entryLevel} onChange={(x) => set("entryLevel", x)} />
      </div>
      {app.choices.length > 1 && <Check label={t("sy.redirect")} checked={v.redirect} onChange={(x) => set("redirect", x)} />}
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Nav busy={busy} back={c.back} first={false} exit={() => run(async () => { await save(true); c.exit(); })} />
    </form>
  );
}

// ---------------------------------------------------------------- sponsor + how you heard
function Sponsor({ c }: { c: Ctx }) {
  const { t } = useT();
  const s0 = c.app.form?.sponsor ?? {};
  const { v, set } = useFields<any>({ type: s0.type ?? "", name: s0.name ?? "", relationship: s0.relationship ?? "", contactPerson: s0.contactPerson ?? "", position: s0.position ?? "", phone: s0.phone ?? "", email: s0.email ?? "", address: s0.address ?? "" });
  const [heard, setHeard] = useState<string[]>(c.app.form?.heardAbout?.channels ?? []);
  const { busy, msg, run } = useBusy();
  const third = v.type && v.type !== "SELF";
  const save = async (partial = false) => {
    const q = partial ? "?partial=1" : "";
    await put(`/me/applications/${c.app.id}/section/sponsor${q}`, clean(third ? v : { type: v.type }));
    await put(`/me/applications/${c.app.id}/section/heardAbout${q}`, { channels: heard });
    await c.reload();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => { await save(); c.next(); }); }}>
      <Sel label={t("sp.type")} required value={v.type} onChange={(x) => set("type", x)} options={["SELF", "PARENT", "EMPLOYER", "HESLGB", "OTHER"].map((k) => [k, t(`spt.${k}`)])} />
      {third && <div className="grid two">
        <Txt label={t("sp.name")} value={v.name} onChange={(x) => set("name", x)} /><Txt label={t("sp.relationship")} value={v.relationship} onChange={(x) => set("relationship", x)} />
        {v.type === "EMPLOYER" && <><Txt label={t("sp.contact")} value={v.contactPerson} onChange={(x) => set("contactPerson", x)} /><Txt label={t("sp.position")} value={v.position} onChange={(x) => set("position", x)} /></>}
        <Txt label={t("sp.phone")} type="tel" value={v.phone} onChange={(x) => set("phone", x)} /><Txt label={t("sp.email")} type="email" value={v.email} onChange={(x) => set("email", x)} />
        <Txt label={t("sp.address")} value={v.address} onChange={(x) => set("address", x)} />
      </div>}
      <h2 style={{ marginTop: "1rem" }}>{t("heard.title")}</h2>
      <div className="grid two">{HEARD.map((h) => <Check key={h} label={t(`heard.${h}`)} checked={heard.includes(h)} onChange={(on) => setHeard(on ? [...heard, h] : heard.filter((x) => x !== h))} />)}</div>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Nav busy={busy} back={c.back} first={false} exit={() => run(async () => { await save(true); c.exit(); })} />
    </form>
  );
}

// ---------------------------------------------------------------- documents
function Documents({ c }: { c: Ctx }) {
  const { t } = useT();
  const { app } = c;
  const creds = useLoad<any[]>(`/me/students/${app.studentId}/credentials`);
  const [sel, setSel] = useState<string[]>(app.attachedCredentialIds ?? []);
  const [kind, setKind] = useState(c.school ? "SCHOOL_REPORT" : "ID");
  const { busy, msg, run } = useBusy();
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => { await put(`/me/applications/${app.id}/documents`, { credentialIds: sel }); await c.reload(); c.next(); }); }}>
      <p className="muted">{t("doc.help")}</p>
      <Msg kind="info">{c.school ? t("doc.needSchool") : t("doc.needCollege")}</Msg>
      <Card title={t("doc.attached")}>
        <Loading error={creds.error} loading={creds.loading} />
        {creds.data?.map((d) => <Check key={d.id} label={`${d.title} · ${t(`dockind.${d.kind}`) === `dockind.${d.kind}` ? d.kind : t(`dockind.${d.kind}`)}${ACADEMIC_KINDS.includes(d.kind) || d.kind === "ID" ? " ✓" : ""}`} checked={sel.includes(d.id)} onChange={(on) => setSel(on ? [...sel, d.id] : sel.filter((x) => x !== d.id))} />)}
        {creds.data?.length === 0 && <p className="muted">{t("common.none")}</p>}
      </Card>
      <Card title={t("common.upload")}>
        <Sel label={t("doc.kind")} required value={kind} onChange={setKind} options={DOC_KINDS.map((k) => [k, t(`dockind.${k}`)])} />
        <Field label={t("common.chooseFile")}>
          <input type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy} onChange={(e) => {
            const file = e.target.files?.[0]; if (!file) return;
            run(async () => { const made = await uploadFile(`/me/students/${app.studentId}/credentials/upload-url`, `/me/students/${app.studentId}/credentials`, file, { kind, title: t(`dockind.${kind}`) }); setSel((p) => [...p, made.id]); await creds.reload(); });
            e.target.value = "";
          }} />
        </Field>
        {busy && <p className="muted">{t("common.uploading")}</p>}
      </Card>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Nav busy={busy} back={c.back} first={false} exit={c.exit} />
    </form>
  );
}

// ---------------------------------------------------------------- review + submit
function Review({ c }: { c: Ctx }) {
  const { t } = useT();
  const err = useErr();
  const router = useRouter();
  const { app } = c;
  const [statement, setStatement] = useState<string>(app.statement ?? "");
  const [accepted, setAccepted] = useState(!!app.form?.declaration?.accepted);
  const [sig, setSig] = useState<string>(app.form?.declaration?.signatureName ?? "");
  const { busy, msg, run, setMsg } = useBusy();
  const STEP_NAME: Record<string, string> = { programmes: "step.programmes", personal: "step.personal", education: "step.education", status: "step.status", guardian: "step.guardian", study: "step.study", sponsor: "step.sponsor", documents: "step.documents", review: "step.review" };

  const submit = async () => {
    setMsg(null);
    try {
      await put(`/me/applications/${app.id}/statement`, { statement });
      await put(`/me/applications/${app.id}/section/declaration`, { accepted: true, signatureName: sig });
      await post(`/me/applications/${app.id}/submit`);
      router.push("/app/family/applications?submitted=1");
    } catch (e) {
      if (e instanceof ApiError && e.code === "incomplete") {
        const steps = [...new Set<string>((e.body?.missing ?? []).map((m: any) => m.step))];
        setMsg({ kind: "err", text: t("rv.missing", { steps: steps.map((s) => t(STEP_NAME[s] ?? s)).join(", ") }) });
        if (steps[0]) c.goto(steps[0]);
      } else setMsg({ kind: "err", text: err(e) });
    }
  };
  return (
    <div>
      <Card title={t("step.programmes")}>
        {app.choices.map((x: any) => <div key={x.rank} className="srow"><span>{t("wiz.choice", { n: x.rank })}</span><span><strong>{x.program.title}</strong></span></div>)}
        <div className="srow"><span>{t("fam.totalToPay")}</span><strong>{mk(app.totalDueMinor)}</strong></div>
        <button type="button" className="linkbtn" onClick={() => c.goto("programmes")}>{t("common.edit")}</button>
      </Card>
      <Card><FormSummary form={app.form} onEdit={c.goto} /></Card>
      <Area label={t("rv.statement")} value={statement} onChange={setStatement} maxLength={3000} />
      <Card>
        <Check label={t("rv.declaration")} checked={accepted} onChange={setAccepted} />
        <Txt label={t("rv.signature")} value={sig} onChange={setSig} maxLength={120} />
      </Card>
      <Msg kind="warn">{t("rv.noCash")}</Msg>
      <p className="muted">{t("rv.next")}</p>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Btn type="button" kind="ghost" onClick={c.back}>{t("wiz.back")}</Btn>
        <Btn kind="primary" busy={busy} disabled={!accepted || sig.trim().length < 2} onClick={() => run(submit)}>{t("rv.submit")}</Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- shell
export function Wizard({ appId }: { appId: string }) {
  const { t } = useT();
  const router = useRouter();
  const [app, setApp] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [i, setI] = useState(0);
  const reload = useCallback(async () => { try { setApp(await api(`/me/applications/${appId}`)); } catch (e) { setError(e); } }, [appId]);
  useEffect(() => { reload(); }, [reload]);

  if (error) return <Loading error={error} />;
  if (!app) return <Loading loading />;
  const school = isSchool(app.institution.type);
  const steps = school ? STEPS_SCHOOL : STEPS_COLLEGE;
  const cur = steps[i]!;
  const label = (s: Step) => t(s === "programmes" && school ? "step.class" : `step.${s}`);
  const ctx: Ctx = { app, reload, school, first: i === 0, next: () => { setI((x) => Math.min(x + 1, steps.length - 1)); window.scrollTo(0, 0); }, back: () => setI((x) => Math.max(0, x - 1)), goto: (s) => { const k = steps.indexOf(s as Step); if (k >= 0) { setI(k); window.scrollTo(0, 0); } }, exit: () => router.push("/app/family/applications") };
  const Body = { programmes: Programmes, personal: Personal, education: Education, status: Status, guardian: Guardian, study: Study, sponsor: Sponsor, documents: Documents, review: Review }[cur];

  return (
    <div>
      <ol className="stepper" aria-label={t("wiz.stepOf", { n: i + 1, total: steps.length })}>
        {steps.map((s, k) => <li key={s} className={k < i ? "done" : k === i ? "cur" : ""} aria-current={k === i ? "step" : undefined}>{label(s)}</li>)}
      </ol>
      <p className="muted">{t("wiz.stepOf", { n: i + 1, total: steps.length })} · {app.choices[0] ? (school ? app.choices[0].program.title : app.institution.name) : ""}</p>
      <Card title={label(cur)}><Body key={cur} c={ctx} /></Card>
      <Link href="/app/family/applications" className="muted">{t("fam.continue")} →</Link>
    </div>
  );
}
