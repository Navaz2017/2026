import { useRouter } from "expo-router";
import { useSession } from "./session";
import React, { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { ApiError, put, post, uploadPicked } from "./api";
import { ACADEMIC_KINDS, DOC_KINDS, pickFile, pickPhoto } from "./files";
import { DATE_RE, HEARD, MODES, NATIONALITIES, OTHER_QUALS, QUALS, clean } from "./forms";
import { useT } from "./i18n";
import { cacheSet, flushOutbox, overlayApplication, pendingFor, useResource, writeOrQueue } from "./offline";
import { CashOut } from "./CashOut";
import { ProgramFacts, isSchool } from "./school";
import { Badge, Btn, C, Card, Check, DateField, Field, LinkBtn, Loading, Msg, P, Row, Select, dt, mk, useBusy, useErr } from "./ui";

type Step = "programmes" | "personal" | "education" | "status" | "guardian" | "study" | "sponsor" | "documents" | "payment" | "review";
const STEPS_COLLEGE: Step[] = ["programmes", "personal", "education", "status", "guardian", "study", "sponsor", "documents", "payment", "review"];
const STEPS_SCHOOL: Step[] = ["programmes", "personal", "education", "guardian", "documents", "payment", "review"];

interface Ctx { app: any; reload: () => void; saved: (name: string, body: unknown) => void; next: () => void; back: () => void; first: boolean; school: boolean; goto: (s: string) => void; exit: () => void; queuedNote: (q: boolean) => void }

// Save one section. Online: the server validates and answers. Offline: kept on the phone, sent when the connection returns.
function useSection(c: Ctx, name: string) {
  const { busy, msg, run, setMsg } = useBusy();
  const { t } = useT();
  const save = async (body: unknown, partial = false) => {
    const r = await writeOrQueue(`/me/applications/${c.app.id}/section/${name}${partial ? "?partial=1" : ""}`, body);
    c.saved(name, body);
    if (r.queued) setMsg({ kind: "info", text: t("m.queued") });
    return r;
  };
  return { busy, msg, run, save, setMsg };
}

const Nav = ({ busy, c, onNext, onExit, nextLabel }: { busy: boolean; c: Ctx; onNext: () => void; onExit?: () => void; nextLabel?: string }) => {
  const { t } = useT();
  return (
    <View style={{ marginTop: 8 }}>
      <Btn testID="next" label={nextLabel ?? t("wiz.next")} busy={busy} onPress={onNext} />
      {!c.first && <Btn kind="ghost" label={t("wiz.back")} onPress={c.back} />}
      {onExit && <LinkBtn label={t("wiz.saveExit")} onPress={onExit} />}
    </View>
  );
};

function useFields<T extends Record<string, any>>(init: T) {
  const [v, setV] = useState<T>(init);
  return { v, set: (k: keyof T) => (val: any) => setV((p) => ({ ...p, [k]: val })) };
}
const yn = (t: (k: string) => string): [string, string][] => [["N", t("common.no")], ["Y", t("common.yes")]];

// ---------------------------------------------------------------- programmes / class (needs a connection: the server works out the fee)
function Programmes({ c }: { c: Ctx }) {
  const { t } = useT();
  const { app } = c;
  const max: number = app.maxChoices;
  const page = useResource<any>(`/public/institutions/${app.institution.id}`);
  const [ids, setIds] = useState<string[]>(app.choices.map((x: any) => x.program.id));
  const { busy, msg, run } = useBusy();
  const programs: any[] = page.data?.programs ?? [];
  const byId = (id: string) => programs.find((p) => p.id === id) ?? app.choices.find((x: any) => x.program.id === id)?.program;
  const open = programs.filter((p) => p.seats - p.seatsTaken > 0);
  const move = (i: number) => { const a = [...ids]; [a[i - 1], a[i]] = [a[i]!, a[i - 1]!]; setIds(a); };
  return (
    <View>
      <P>{c.school ? t("wiz.chooseClass") : t("wiz.choose", { max, name: app.institution.name })}</P>
      <Loading error={page.error} loading={page.loading && !page.data} />
      {c.school ? (
        <Select label={t("step.class")} required value={ids[0] ?? ""} onChange={(v) => setIds(v ? [v] : [])} options={open.map((p): [string, string] => [p.id, p.title])} />
      ) : (
        <>
          {ids.map((id, i) => { const p = byId(id); return (
            <Card key={id}>
              <Text style={{ fontWeight: "700", fontSize: 16, color: C.ink }}>{t("wiz.choice", { n: i + 1 })}: {p?.title}{p?.code ? `  ·  ${p.code}` : ""}</Text>
              {p && <ProgramFacts p={p} />}
              <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
                {i > 0 && <LinkBtn label={t("wiz.moveUp")} onPress={() => move(i)} />}
                {ids.length > 1 && <LinkBtn label={t("wiz.remove")} onPress={() => setIds(ids.filter((x) => x !== id))} />}
              </View>
            </Card>
          ); })}
          {ids.length < max
            ? (open.filter((p) => !ids.includes(p.id)).length > 0
              ? <Select label={t("wiz.addChoice")} value="" onChange={(v) => v && setIds([...ids, v])} options={open.filter((p) => !ids.includes(p.id)).map((p): [string, string] => [p.id, p.title])} />
              : <P muted>{t("wiz.noMore")}</P>)
            : <Msg kind="info">{t("wiz.maxReached", { max })}</Msg>}
        </>
      )}
      <Msg kind="info">{t("prog.feeNote")} {t("fam.totalToPay")}: {mk(app.totalDueMinor)}</Msg>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Nav busy={busy} c={c} onNext={() => run(async () => { await put(`/me/applications/${app.id}/choices`, { programIds: ids }); c.reload(); c.next(); })} />
    </View>
  );
}

// ---------------------------------------------------------------- personal (+ special needs)
function Personal({ c }: { c: Ctx }) {
  const { t } = useT();
  const { app } = c;
  const prof = app.form?.personal ?? app.student.profile ?? {};
  const parts = (app.student.fullName ?? "").split(" ");
  const epoch = String(app.student.dateOfBirth).startsWith("1970");
  const { v, set } = useFields<any>({ surname: prof.surname ?? (parts.length > 1 ? parts[parts.length - 1] : ""), firstName: prof.firstName ?? parts[0] ?? "", middleName: prof.middleName ?? "", gender: prof.gender ?? "", dateOfBirth: (prof.dateOfBirth ?? (epoch ? "" : app.student.dateOfBirth) ?? "").slice(0, 10), nationality: prof.nationality ?? "Malawian", nationalId: prof.nationalId ?? "", homeDistrict: prof.homeDistrict ?? "", village: prof.village ?? "", religion: prof.religion ?? "", physicalAddress: prof.physicalAddress ?? "", postalAddress: prof.postalAddress ?? "", email: prof.email ?? "" });
  const sn = useFields<any>({ hasDisability: app.form?.specialNeeds?.hasDisability ?? false, details: app.form?.specialNeeds?.details ?? "", assistance: app.form?.specialNeeds?.assistance ?? "" });
  const S = useSection(c, "personal"), N = useSection(c, "specialNeeds");
  const save = async (partial = false) => {
    await S.save(clean(v), partial);
    await N.save(clean({ ...sn.v, details: sn.v.hasDisability ? sn.v.details : "", assistance: sn.v.hasDisability ? sn.v.assistance : "" }), partial);
  };
  return (
    <View>
      <Field testID="surname" label={t("p.surname")} required value={v.surname} onChange={set("surname")} />
      <Field testID="firstName" label={t("p.firstName")} required value={v.firstName} onChange={set("firstName")} />
      <Field label={t("p.middleName")} value={v.middleName} onChange={set("middleName")} />
      <Select label={t("p.gender")} required value={v.gender} onChange={set("gender")} options={[["M", t("p.male")], ["F", t("p.female")]]} />
      <DateField testID="dob" label={t("p.dob")} required value={v.dateOfBirth} onChange={set("dateOfBirth")} />
      <Select label={t("p.nationality")} required value={v.nationality} onChange={set("nationality")} options={(NATIONALITIES.includes(v.nationality) || !v.nationality ? NATIONALITIES : [v.nationality, ...NATIONALITIES]).map((n): [string, string] => [n, n])} />
      <Field label={t("p.nationalId")} value={v.nationalId} onChange={set("nationalId")} autoCapitalize="characters" />
      <Field testID="district" label={t("p.homeDistrict")} required value={v.homeDistrict} onChange={set("homeDistrict")} />
      <Field label={t("p.village")} value={v.village} onChange={set("village")} />
      <Field testID="address" label={t("p.address")} required value={v.physicalAddress} onChange={set("physicalAddress")} />
      <Field label={t("p.postal")} value={v.postalAddress} onChange={set("postalAddress")} />
      <Field label={t("p.email")} value={v.email} onChange={set("email")} keyboardType="email-address" autoCapitalize="none" />
      <Field label={t("p.religion")} value={v.religion} onChange={set("religion")} />
      <Text style={{ fontSize: 18, fontWeight: "700", color: C.ink, marginVertical: 8 }}>{t("sn.title")}</Text>
      <Select label={t("sn.has")} required value={sn.v.hasDisability ? "Y" : "N"} onChange={(x) => sn.set("hasDisability")(x === "Y")} options={yn(t)} />
      {sn.v.hasDisability && <><Field label={t("sn.details")} multiline value={sn.v.details} onChange={sn.set("details")} maxLength={500} /><Field label={t("sn.assist")} multiline value={sn.v.assistance} onChange={sn.set("assistance")} maxLength={500} /></>}
      {S.msg && <Msg kind={S.msg.kind}>{S.msg.text}</Msg>}
      <Nav busy={S.busy} c={c} onNext={() => S.run(async () => { if (!DATE_RE.test(v.dateOfBirth)) { throw new ApiError(400, "validation"); } await save(); c.next(); })} onExit={() => S.run(async () => { await save(true); c.exit(); })} />
    </View>
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
  const schools = useResource<any[]>(c.school ? "/public/institutions" : null);
  const S = useSection(c, "education");
  const body = () => clean({
    ...v, year: v.year ? Number(v.year) : undefined, totalPoints: v.totalPoints !== "" ? Number(v.totalPoints) : undefined, previousSchoolId: v.previousSchoolId || undefined,
    requestGrades: v.previousSchoolId ? !!v.requestGrades : false, subjects: subjects.filter((s) => s.subject && s.grade), otherQualifications: others.filter((o) => o.institution && o.year).map((o) => ({ ...o, year: Number(o.year) })),
    disciplined: c.school ? undefined : { yes: !!v.disciplinedYes, details: v.disciplinedYes ? v.disciplinedDetails : undefined }, disciplinedYes: undefined, disciplinedDetails: undefined,
  });
  const upd = <T,>(arr: T[], i: number, patch: Partial<T>) => arr.map((y, j) => (j === i ? { ...y, ...patch } : y));
  return (
    <View>
      {c.school ? (
        <>
          {std1 && <Msg kind="info">{t("ed.std1")}</Msg>}
          <Select label={t("ed.prevOnPlatform")} value={v.previousSchoolId} onChange={(x) => { set("previousSchoolId")(x); const s = schools.data?.find((y) => y.id === x); if (s) set("previousSchoolName")(s.name); }} options={(schools.data ?? []).filter((s) => s.id !== app.institution.id).map((s): [string, string] => [s.id, s.name])} />
          <Field testID="prevName" label={t("ed.prevName")} required={!std1 && !v.previousSchoolId} value={v.previousSchoolName} onChange={set("previousSchoolName")} />
          <Field label={t("ed.lastClass")} value={v.lastClassCompleted} onChange={set("lastClassCompleted")} />
          {v.previousSchoolId ? <><Check label={t("ed.requestGrades")} checked={v.requestGrades} onChange={set("requestGrades")} /><P muted>{t("ed.requestGradesHelp")}</P></> : null}
        </>
      ) : (
        <>
          <Select label={t("ed.level")} required value={v.level} onChange={set("level")} options={QUALS.map((q): [string, string] => [q, t(`qual.${q}`)])} />
          <Field testID="eschool" label={t("ed.school")} required value={v.schoolName} onChange={set("schoolName")} />
          <Field testID="eyear" label={t("ed.year")} required value={v.year} onChange={set("year")} keyboardType="number-pad" maxLength={4} />
          <Field label={t("ed.points")} value={v.totalPoints} onChange={set("totalPoints")} keyboardType="number-pad" />
          <Field label={t("ed.centre")} value={v.centreNumber} onChange={set("centreNumber")} />
          <Field label={t("ed.candidate")} value={v.candidateNumber} onChange={set("candidateNumber")} />
          <Text style={{ fontSize: 18, fontWeight: "700", color: C.ink, marginVertical: 8 }}>{t("ed.subjects")}</Text>
          {subjects.map((s, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
              <View style={{ flex: 3 }}><Field testID={`subject${i}`} label={t("ed.subject")} value={s.subject} onChange={(x) => setSubjects(upd(subjects, i, { subject: x }))} /></View>
              <View style={{ flex: 1 }}><Field testID={`grade${i}`} label={t("ed.grade")} value={s.grade} onChange={(x) => setSubjects(upd(subjects, i, { grade: x }))} maxLength={10} /></View>
              {subjects.length > 1 && <LinkBtn label="✕" onPress={() => setSubjects(subjects.filter((_, j) => j !== i))} />}
            </View>
          ))}
          {subjects.length < 12 && <Btn kind="ghost" label={t("ed.addSubject")} onPress={() => setSubjects([...subjects, { subject: "", grade: "" }])} />}
          <Field label={t("ed.resit")} value={v.resitYears} onChange={set("resitYears")} />
          <Text style={{ fontSize: 18, fontWeight: "700", color: C.ink, marginVertical: 8 }}>{t("ed.other")}</Text>
          {others.map((o, i) => (
            <Card key={i}>
              <Select label={t("ed.other")} required value={o.type} onChange={(x) => setOthers(upd(others, i, { type: x }))} options={OTHER_QUALS.map((q): [string, string] => [q, t(`oq.${q}`)])} />
              <Field label={t("ed.institution")} required value={o.institution} onChange={(x) => setOthers(upd(others, i, { institution: x }))} />
              <Field label={t("ed.year")} required value={o.year} onChange={(x) => setOthers(upd(others, i, { year: x }))} keyboardType="number-pad" maxLength={4} />
              <LinkBtn label={t("wiz.remove")} onPress={() => setOthers(others.filter((_, j) => j !== i))} />
            </Card>
          ))}
          {others.length < 5 && <Btn kind="ghost" label={t("ed.addOther")} onPress={() => setOthers([...others, { type: "DIPLOMA", institution: "", year: "" }])} />}
          <Select label={t("ed.disciplined")} required value={v.disciplinedYes ? "Y" : "N"} onChange={(x) => set("disciplinedYes")(x === "Y")} options={yn(t)} />
          {v.disciplinedYes && <Field label={t("ed.disciplinedDetails")} multiline value={v.disciplinedDetails} onChange={set("disciplinedDetails")} maxLength={300} />}
        </>
      )}
      {S.msg && <Msg kind={S.msg.kind}>{S.msg.text}</Msg>}
      <Nav busy={S.busy} c={c} onNext={() => S.run(async () => { await S.save(body()); c.next(); })} onExit={() => S.run(async () => { await S.save(body(), true); c.exit(); })} />
    </View>
  );
}

// ---------------------------------------------------------------- current status (colleges)
function Status({ c }: { c: Ctx }) {
  const { t } = useT();
  const s0 = c.app.form?.status ?? {};
  const { v, set } = useFields<any>({ current: s0.current ?? "", employer: s0.employer ?? "", position: s0.position ?? "", workExperienceYears: s0.workExperienceYears ?? "" });
  const S = useSection(c, "status");
  const work = v.current === "EMPLOYED" || v.current === "SELF_EMPLOYED";
  const body = () => clean({ ...v, employer: work ? v.employer : "", position: work ? v.position : "", workExperienceYears: v.workExperienceYears !== "" ? Number(v.workExperienceYears) : undefined });
  return (
    <View>
      <Select label={t("st.current")} required value={v.current} onChange={set("current")} options={["EMPLOYED", "SELF_EMPLOYED", "UNEMPLOYED", "STUDYING"].map((k): [string, string] => [k, t(`cur.${k}`)])} />
      {work && <><Field label={t("st.employer")} value={v.employer} onChange={set("employer")} /><Field label={t("st.position")} value={v.position} onChange={set("position")} /></>}
      <Field label={t("st.experience")} value={v.workExperienceYears} onChange={set("workExperienceYears")} keyboardType="number-pad" />
      {S.msg && <Msg kind={S.msg.kind}>{S.msg.text}</Msg>}
      <Nav busy={S.busy} c={c} onNext={() => S.run(async () => { await S.save(body()); c.next(); })} onExit={() => S.run(async () => { await S.save(body(), true); c.exit(); })} />
    </View>
  );
}

// ---------------------------------------------------------------- parent / guardian
function Guardian({ c }: { c: Ctx }) {
  const { t } = useT();
  const { user } = useSession();
  const isParent = user?.role === "PARENT"; // a parent applying for a child IS the guardian: their phone is the account's
  const par = c.app.student.parent;
  const g0 = c.app.form?.guardian ?? (par ? { relationship: "PARENT", name: par.user.fullName, phone: par.user.phone ?? "", email: par.user.email ?? "", occupation: par.occupation } : {});
  const { v, set } = useFields<any>({ relationship: g0.relationship ?? "PARENT", name: g0.name ?? "", phone: g0.phone ?? "", email: g0.email ?? "", address: g0.address ?? "", village: g0.village ?? "", district: g0.district ?? "", occupation: g0.occupation ?? "" });
  const S = useSection(c, "guardian");
  return (
    <View>
      <Select label={t("g.relationship")} required value={v.relationship} onChange={set("relationship")} options={["PARENT", "GUARDIAN", "NEXT_OF_KIN"].map((k): [string, string] => [k, t(`rel.${k}`)])} />
      <Field testID="gname" label={t("g.name")} required value={v.name} onChange={set("name")} />
      {!isParent && <Field testID="gphone" label={t("g.phone")} required value={v.phone} onChange={set("phone")} keyboardType="phone-pad" />}
      <Field label={t("g.email")} value={v.email} onChange={set("email")} keyboardType="email-address" autoCapitalize="none" />
      <Field label={t("g.occupation")} value={v.occupation} onChange={set("occupation")} />
      <Field label={t("g.address")} value={v.address} onChange={set("address")} />
      <Field label={t("g.village")} value={v.village} onChange={set("village")} />
      <Field label={t("g.district")} value={v.district} onChange={set("district")} />
      {S.msg && <Msg kind={S.msg.kind}>{S.msg.text}</Msg>}
      <Nav busy={S.busy} c={c} onNext={() => S.run(async () => { await S.save(clean(isParent ? { ...v, phone: "" } : v)); c.next(); })} onExit={() => S.run(async () => { await S.save(clean(isParent ? { ...v, phone: "" } : v), true); c.exit(); })} />
    </View>
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
  const S = useSection(c, "study");
  const body = () => clean({ ...v, redirect: !!v.redirect });
  return (
    <View>
      <Select label={t("sy.mode")} required value={v.mode} onChange={set("mode")} options={modes.map((m): [string, string] => [m, t(`mode.${m}`)])} />
      {app.institution.campuses.length > 0 && <Select label={t("sy.campus")} required value={v.campus} onChange={set("campus")} options={app.institution.campuses.map((x: string): [string, string] => [x, x])} />}
      <Field label={t("sy.entry")} value={v.entryLevel} onChange={set("entryLevel")} />
      {app.choices.length > 1 && <Check label={t("sy.redirect")} checked={v.redirect} onChange={set("redirect")} />}
      {S.msg && <Msg kind={S.msg.kind}>{S.msg.text}</Msg>}
      <Nav busy={S.busy} c={c} onNext={() => S.run(async () => { await S.save(body()); c.next(); })} onExit={() => S.run(async () => { await S.save(body(), true); c.exit(); })} />
    </View>
  );
}

// ---------------------------------------------------------------- sponsor + how you heard
function Sponsor({ c }: { c: Ctx }) {
  const { t } = useT();
  const s0 = c.app.form?.sponsor ?? {};
  const { v, set } = useFields<any>({ type: s0.type ?? "", name: s0.name ?? "", relationship: s0.relationship ?? "", contactPerson: s0.contactPerson ?? "", position: s0.position ?? "", phone: s0.phone ?? "", email: s0.email ?? "", address: s0.address ?? "" });
  const [heard, setHeard] = useState<string[]>(c.app.form?.heardAbout?.channels ?? []);
  const S = useSection(c, "sponsor"), H = useSection(c, "heardAbout");
  const third = v.type && v.type !== "SELF";
  const save = async (partial = false) => { await S.save(clean(third ? v : { type: v.type }), partial); await H.save({ channels: heard }, partial); };
  return (
    <View>
      <Select label={t("sp.type")} required value={v.type} onChange={set("type")} options={["SELF", "PARENT", "EMPLOYER", "HESLGB", "OTHER"].map((k): [string, string] => [k, t(`spt.${k}`)])} />
      {third && <>
        <Field label={t("sp.name")} value={v.name} onChange={set("name")} /><Field label={t("sp.relationship")} value={v.relationship} onChange={set("relationship")} />
        {v.type === "EMPLOYER" && <><Field label={t("sp.contact")} value={v.contactPerson} onChange={set("contactPerson")} /><Field label={t("sp.position")} value={v.position} onChange={set("position")} /></>}
        <Field label={t("sp.phone")} value={v.phone} onChange={set("phone")} keyboardType="phone-pad" /><Field label={t("sp.email")} value={v.email} onChange={set("email")} keyboardType="email-address" autoCapitalize="none" />
        <Field label={t("sp.address")} value={v.address} onChange={set("address")} />
      </>}
      <Text style={{ fontSize: 18, fontWeight: "700", color: C.ink, marginVertical: 8 }}>{t("heard.title")}</Text>
      {HEARD.map((h) => <Check key={h} label={t(`heard.${h}`)} checked={heard.includes(h)} onChange={(on) => setHeard(on ? [...heard, h] : heard.filter((x) => x !== h))} />)}
      {S.msg && <Msg kind={S.msg.kind}>{S.msg.text}</Msg>}
      <Nav busy={S.busy || H.busy} c={c} onNext={() => S.run(async () => { await save(); c.next(); })} onExit={() => S.run(async () => { await save(true); c.exit(); })} />
    </View>
  );
}

// ---------------------------------------------------------------- documents
function Documents({ c }: { c: Ctx }) {
  const { t } = useT();
  const { app } = c;
  const creds = useResource<any[]>(`/me/students/${app.studentId}/credentials`);
  const [sel, setSel] = useState<string[]>(app.attachedCredentialIds ?? []);
  const [kind, setKind] = useState(c.school ? "SCHOOL_REPORT" : "ID");
  const { busy, msg, run, setMsg } = useBusy();
  const { busy: upBusy, msg: upMsg, run: upRun } = useBusy();
  return (
    <View>
      <P muted>{t("doc.help")}</P>
      <Msg kind="info">{c.school ? t("doc.needSchool") : t("doc.needCollege")}</Msg>
      <Card title={t("doc.attached")}>
        <Loading error={creds.error} loading={creds.loading && !creds.data} />
        {creds.data?.map((d) => <Check key={d.id} label={`${d.title} · ${t(`dockind.${d.kind}`) === `dockind.${d.kind}` ? d.kind : t(`dockind.${d.kind}`)}${ACADEMIC_KINDS.includes(d.kind) || d.kind === "ID" ? " ✓" : ""}`} checked={sel.includes(d.id)} onChange={(on) => setSel(on ? [...sel, d.id] : sel.filter((x) => x !== d.id))} />)}
        {creds.data?.length === 0 && <P muted>{t("common.none")}</P>}
      </Card>
      <Card title={t("common.upload")}>
        <Select label={t("doc.kind")} required value={kind} onChange={setKind} options={DOC_KINDS.map((k): [string, string] => [k, t(`dockind.${k}`)])} />
        <Btn testID="photo" label={t("m.photo")} busy={upBusy} onPress={() => upRun(async () => {
          const f = await pickPhoto(); if (!f) return;
          const made = await uploadPicked(`/me/students/${app.studentId}/credentials/upload-url`, `/me/students/${app.studentId}/credentials`, f, { kind, title: t(`dockind.${kind}`) });
          setSel((p) => [...p, made.id]); creds.reload();
        })} />
        <Btn testID="pick" kind="ghost" label={upBusy ? t("common.uploading") : t("m.chooseFileOrPhoto")} busy={upBusy} onPress={() => upRun(async () => {
          const f = await pickFile(); if (!f) return;
          const made = await uploadPicked(`/me/students/${app.studentId}/credentials/upload-url`, `/me/students/${app.studentId}/credentials`, f, { kind, title: t(`dockind.${kind}`) });
          setSel((p) => [...p, made.id]); creds.reload();
        })} />
        {upMsg && <Msg kind={upMsg.kind}>{upMsg.text}</Msg>}
      </Card>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Nav busy={busy} c={c} onNext={() => run(async () => {
        const r = await writeOrQueue(`/me/applications/${app.id}/documents`, { credentialIds: sel });
        c.saved("__documents", sel);
        if (r.queued) setMsg({ kind: "info", text: t("m.queued") });
        c.next();
      })} onExit={c.exit} />
    </View>
  );
}

// ---------------------------------------------------------------- payment (BEFORE submitting; needs a connection to look up the number)
function Payment({ c }: { c: Ctx }) {
  const { t } = useT();
  const { user } = useSession();
  const { app } = c;
  const info = useResource<any>("/public/payment-info");
  const p0 = app.form?.payment ?? {};
  const { v, set } = useFields<any>({ provider: p0.provider ?? "", reference: p0.reference ?? "", payerPhone: p0.payerPhone ?? user?.phone ?? "" });
  const S = useSection(c, "payment");
  const body = () => ({ provider: v.provider, reference: v.reference.trim(), payerPhone: v.payerPhone.trim() });
  return (
    <View>
      <P>{t("wiz.payIntro")}</P>
      <Msg kind="info">{t("fam.totalToPay")}: {mk(app.totalDueMinor)}</Msg>
      <Select label={t("fam.provider")} required value={v.provider} onChange={set("provider")} options={["AIRTEL_MONEY", "MPAMBA"].map((k): [string, string] => [k, t(`provider.${k}`)])} />
      {v.provider ? <CashOut info={info.data} provider={v.provider} /> : null}
      <Field testID="payRef" label={t("fam.reference")} hint={t("wiz.tidHelp")} required value={v.reference} onChange={set("reference")} autoCapitalize="characters" maxLength={30} />
      <Field testID="payPhone" label={t("fam.payerPhone")} required value={v.payerPhone} onChange={set("payerPhone")} keyboardType="phone-pad" placeholder="0999 123 456" />
      <P muted>{t("wiz.payCheck")}</P>
      {S.msg && <Msg kind={S.msg.kind}>{S.msg.text}</Msg>}
      <Nav busy={S.busy} c={c} onNext={() => S.run(async () => { await S.save(body()); c.next(); })} onExit={() => S.run(async () => { await S.save(clean(body()), true); c.exit(); })} />
    </View>
  );
}

// ---------------------------------------------------------------- review + submit (needs a connection)
function Summary({ form, onEdit }: { form: any; onEdit: (s: string) => void }) {
  const { t } = useT();
  const f = form ?? {};
  const p = f.personal, e = f.education, g = f.guardian, s = f.study, sp = f.sponsor, st = f.status;
  const Sec = ({ title, step, children }: { title: string; step: string; children: React.ReactNode }) => (
    <View style={{ borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={{ fontWeight: "700", fontSize: 16, color: C.ink }}>{title}</Text><LinkBtn label={t("common.edit")} onPress={() => onEdit(step)} /></View>{children}
    </View>
  );
  return (
    <View>
      {p && <Sec title={t("step.personal")} step="personal">
        <Row k={t("auth.fullName")} v={[p.firstName, p.middleName, p.surname].filter(Boolean).join(" ")} />
        <Row k={t("p.gender")} v={p.gender === "M" ? t("p.male") : p.gender === "F" ? t("p.female") : ""} /><Row k={t("p.dob")} v={dt(p.dateOfBirth)} />
        <Row k={t("p.nationalId")} v={p.nationalId} /><Row k={t("p.homeDistrict")} v={p.homeDistrict} /><Row k={t("p.address")} v={p.physicalAddress} /><Row k={t("p.phone")} v={p.phone} />
      </Sec>}
      {e && <Sec title={t("step.education")} step="education">
        <Row k={t("ed.level")} v={e.level && t(`qual.${e.level}`)} /><Row k={t("ed.school")} v={e.schoolName} /><Row k={t("ed.year")} v={e.year} />
        <Row k={t("ed.prevSchool")} v={e.previousSchoolName} /><Row k={t("ed.lastClass")} v={e.lastClassCompleted} />
        {e.subjects?.map((x: any, i: number) => <Row key={i} k={x.subject} v={x.grade} />)}
      </Sec>}
      {st && <Sec title={t("step.status")} step="status"><Row k={t("st.current")} v={t(`cur.${st.current}`)} /><Row k={t("st.employer")} v={st.employer} /></Sec>}
      {g && <Sec title={t("step.guardian")} step="guardian"><Row k={t(`rel.${g.relationship}`)} v={g.name} /><Row k={t("g.phone")} v={g.phone} /></Sec>}
      {s && <Sec title={t("step.study")} step="study"><Row k={t("sy.mode")} v={s.mode && t(`mode.${s.mode}`)} /><Row k={t("sy.campus")} v={s.campus} /></Sec>}
      {f.payment && <Sec title={t("step.payment")} step="payment"><Row k={t("fam.provider")} v={t(`provider.${f.payment.provider}`)} /><Row k={t("fam.reference")} v={f.payment.reference} /></Sec>}
      {sp && <Sec title={t("step.sponsor")} step="sponsor"><Row k={t("sp.type")} v={t(`spt.${sp.type}`)} /><Row k={t("sp.name")} v={sp.name} /></Sec>}
    </View>
  );
}

const STEP_NAME: Record<string, string> = { programmes: "step.programmes", personal: "step.personal", education: "step.education", status: "step.status", guardian: "step.guardian", study: "step.study", sponsor: "step.sponsor", documents: "step.documents", payment: "step.payment", review: "step.review" };

function Review({ c }: { c: Ctx }) {
  const { t } = useT();
  const err = useErr();
  const router = useRouter();
  const { app } = c;
  const [statement, setStatement] = useState<string>(app.statement ?? "");
  const [accepted, setAccepted] = useState(!!app.form?.declaration?.accepted);
  const [sig, setSig] = useState<string>(app.form?.declaration?.signatureName ?? "");
  const { busy, msg, run, setMsg } = useBusy();
  const submit = async () => {
    setMsg(null);
    try {
      // Everything typed offline must reach the server first.
      await flushOutbox();
      if (pendingFor(`/me/applications/${app.id}`).length > 0) throw new ApiError(0, "network");
      await put(`/me/applications/${app.id}/statement`, { statement });
      await put(`/me/applications/${app.id}/section/declaration`, { accepted: true, signatureName: sig });
      await post(`/me/applications/${app.id}/submit`);
      router.replace(`/application/${app.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "reference_already_used") { setMsg({ kind: "err", text: err(e) }); c.goto("payment"); }
      else if (e instanceof ApiError && e.code === "incomplete") {
        const steps = [...new Set<string>((e.body?.missing ?? []).map((m: any) => m.step))];
        setMsg({ kind: "err", text: t("rv.missing", { steps: steps.map((s) => t(STEP_NAME[s] ?? s)).join(", ") }) });
        if (steps[0]) c.goto(steps[0]);
      } else if (e instanceof ApiError && e.code === "phone_not_verified") { router.replace("/verify"); }
      else setMsg({ kind: "err", text: e instanceof ApiError && e.status === 0 ? t("m.needsInternet") : err(e) });
    }
  };
  return (
    <View>
      <Card title={t("step.programmes")}>
        {app.choices.map((x: any) => <Row key={x.rank} k={t("wiz.choice", { n: x.rank })} v={x.program.title} />)}
        <Row k={t("fam.totalToPay")} v={mk(app.totalDueMinor)} />
        <LinkBtn label={t("common.edit")} onPress={() => c.goto("programmes")} />
      </Card>
      <Card><Summary form={app.form} onEdit={c.goto} /></Card>
      <Field label={t("rv.statement")} multiline value={statement} onChange={setStatement} maxLength={3000} />
      <Card>
        <Check label={t("rv.declaration")} checked={accepted} onChange={setAccepted} />
        <Field testID="signature" label={t("rv.signature")} value={sig} onChange={setSig} maxLength={120} />
      </Card>
      <Msg kind="warn">{t("rv.noCash")}</Msg>
      <P muted>{t("rv.next")}</P>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <Btn testID="submit" label={t("rv.submit")} busy={busy} disabled={!accepted || sig.trim().length < 2} onPress={() => run(submit)} />
      <Btn kind="ghost" label={t("wiz.back")} onPress={c.back} />
    </View>
  );
}

// ---------------------------------------------------------------- shell
export function Wizard({ appId }: { appId: string }) {
  const { t } = useT();
  const router = useRouter();
  const res = useResource<any>(`/me/applications/${appId}`, overlayApplication);
  const [i, setI] = useState(0);
  const app = res.data;
  const saved = useCallback((name: string, body: unknown) => {
    res.setData((a: any) => {
      if (!a) return a;
      const next = name === "__documents" ? { ...a, attachedCredentialIds: body } : { ...a, form: { ...(a.form ?? {}), [name]: body } };
      void cacheSet(`/me/applications/${appId}`, next);
      return next;
    });
  }, [appId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (res.error && !app) return <Loading error={res.error} />;
  if (!app) return <Loading loading />;
  const school = isSchool(app.institution.type);
  const steps = school ? STEPS_SCHOOL : STEPS_COLLEGE;
  const cur = steps[i]!;
  const label = (s: Step) => t(s === "programmes" && school ? "step.class" : `step.${s}`);
  const ctx: Ctx = { app, reload: res.reload, saved, school, first: i === 0, queuedNote: () => {}, next: () => setI((x) => Math.min(x + 1, steps.length - 1)), back: () => setI((x) => Math.max(0, x - 1)), goto: (s) => { const k = steps.indexOf(s as Step); if (k >= 0) setI(k); }, exit: () => router.replace("/applications") };
  const Body = { programmes: Programmes, personal: Personal, education: Education, status: Status, guardian: Guardian, study: Study, sponsor: Sponsor, documents: Documents, payment: Payment, review: Review }[cur];
  return (
    <View>
      <View style={{ flexDirection: "row", gap: 4, marginBottom: 8 }} accessibilityLabel={t("wiz.stepOf", { n: i + 1, total: steps.length })}>
        {steps.map((s, k) => <View key={s} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: k <= i ? C.navy : C.line }} />)}
      </View>
      <P muted>{t("wiz.stepOf", { n: i + 1, total: steps.length })} · {school ? app.choices[0]?.program?.title ?? app.institution.name : app.institution.name}</P>
      {res.offline && <Msg kind="info">{t("common.offline")}</Msg>}
      <Card title={label(cur)}><Body key={cur} c={ctx} /></Card>
    </View>
  );
}
