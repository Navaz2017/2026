import { z } from "zod";
import { isSchool } from "./levels.js";

// Fields are taken from real application forms of Malawian institutions (MCA, Daeyang, Millennium University, ABMA):
// personal details -> special needs -> education -> current status -> parent/guardian -> study options ->
// sponsorship -> how you heard about us -> declaration. Programme choices and documents are separate endpoints.
const txt = (max = 200) => z.string().trim().max(max);
const req = (max = 200) => z.string().trim().min(1).max(max);
const phone = z.string().trim().min(7).max(20);

export const personal = z.object({
  surname: req(80), firstName: req(80), middleName: txt(80).optional(),
  gender: z.enum(["M", "F"]), dateOfBirth: z.coerce.date(),
  nationality: req(60), nationalId: txt(40).optional(), // ID or passport number
  homeDistrict: req(60), village: txt(80).optional(),
  religion: txt(60).optional(), // optional: not an admission criterion
  physicalAddress: req(200), postalAddress: txt(200).optional(),
  phone: phone.optional(), // not asked: taken from the phone number the account signed up with
  email: z.string().email().optional().or(z.literal("")),
});

export const specialNeeds = z.object({ hasDisability: z.boolean(), details: txt(500).optional(), assistance: txt(500).optional() });

export const QUALIFICATIONS = ["PSLCE", "JCE", "MSCE", "IGCSE", "A_LEVEL", "AS", "COSC", "MATRIC", "IB", "OTHER"] as const;
export const education = z.object({
  level: z.enum(QUALIFICATIONS).optional(), // highest school qualification completed (not needed for Standard 1 entrants)
  schoolName: txt(120).optional(), year: z.coerce.number().int().min(1950).max(2100).optional(),
  centreNumber: txt(30).optional(), candidateNumber: txt(30).optional(), totalPoints: z.coerce.number().int().min(0).max(1000).optional(),
  subjects: z.array(z.object({ subject: req(60), grade: req(10) })).max(12).default([]),
  resitYears: txt(60).optional(),
  otherQualifications: z.array(z.object({ type: z.enum(["CERTIFICATE", "DIPLOMA", "BACHELORS", "MASTERS"]), institution: req(120), year: z.coerce.number().int().min(1950).max(2100) })).max(5).default([]),
  previousSchoolId: z.string().uuid().optional(), // a school registered on Enrolla -> grades can be requested from it
  previousSchoolName: txt(120).optional(), lastClassCompleted: txt(40).optional(),
  requestGrades: z.boolean().optional(),
  disciplined: z.object({ yes: z.boolean(), details: txt(300).optional() }).optional(),
});

export const status = z.object({
  current: z.enum(["EMPLOYED", "SELF_EMPLOYED", "UNEMPLOYED", "STUDYING"]),
  employer: txt(120).optional(), position: txt(80).optional(), workExperienceYears: z.coerce.number().min(0).max(60).optional(),
});

export const guardian = z.object({
  relationship: z.enum(["PARENT", "GUARDIAN", "NEXT_OF_KIN"]), name: req(120), phone, email: z.string().email().optional().or(z.literal("")),
  address: txt(200).optional(), village: txt(80).optional(), district: txt(60).optional(), occupation: txt(80).optional(),
});

export const study = z.object({
  mode: z.enum(["FULL_TIME", "PART_TIME", "WEEKEND", "EVENING", "ODEL"]).optional(), campus: txt(80).optional(),
  entryLevel: txt(40).optional(), // e.g. "Year 1"
  redirect: z.boolean().optional(), // willing to be placed in another programme if the choices are full
});

export const sponsor = z.object({
  type: z.enum(["SELF", "PARENT", "EMPLOYER", "HESLGB", "OTHER"]),
  name: txt(120).optional(), relationship: txt(60).optional(), contactPerson: txt(120).optional(), position: txt(80).optional(),
  phone: phone.optional(), email: z.string().email().optional().or(z.literal("")), address: txt(200).optional(),
});

export const HEARD = ["NEWSPAPER", "RADIO", "TV", "FRIEND", "SOCIAL_MEDIA", "WEBSITE", "OPEN_DAY", "REPRESENTATIVE", "LETTER", "POSTER", "EX_STUDENT", "OTHER"] as const;
export const heardAbout = z.object({ channels: z.array(z.enum(HEARD)).max(12), other: txt(120).optional() });

// The application fee: how it was paid and the transaction ID from the mobile-money message. Entered BEFORE submitting;
// the reference is matched with the incoming SMS afterwards.
export const payment = z.object({
  provider: z.enum(["AIRTEL_MONEY", "MPAMBA"]),
  reference: z.string().trim().min(6).max(30).regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\.?$/),
  payerPhone: z.string().trim().min(7).max(20), // the phone the money was sent from (prefilled with the account's number)
});

export const declaration = z.object({ accepted: z.literal(true), signatureName: req(120) });

export const SECTIONS = { personal, specialNeeds, education, status, guardian, study, sponsor, heardAbout, payment, declaration } as const;
export type SectionName = keyof typeof SECTIONS;

// Which sections each kind of institution needs before an application can be submitted, and which step the UI should open.
export function requiredSections(instType: string): SectionName[] {
  return isSchool(instType)
    ? ["personal", "specialNeeds", "education", "guardian", "payment", "declaration"]
    : ["personal", "specialNeeds", "education", "status", "guardian", "study", "sponsor", "payment", "declaration"];
}

export const SECTION_STEP: Record<SectionName, string> = { personal: "personal", specialNeeds: "personal", education: "education", status: "status", guardian: "guardian", study: "study", sponsor: "sponsor", heardAbout: "sponsor", payment: "payment", declaration: "review" };

export interface Missing { section: string; step: string; message: string }

// Full validation at submit time. Returns every problem so the UI can send the applicant to the right step.
export function validateForSubmit(instType: string, form: Record<string, unknown>, ctx: { age: number; isStandardOneEntry: boolean }): Missing[] {
  const out: Missing[] = [];
  for (const name of requiredSections(instType)) {
    const r = SECTIONS[name].safeParse(form[name]);
    if (!r.success) out.push({ section: name, step: SECTION_STEP[name], message: r.error.issues[0]?.path.join(".") || "required" });
  }
  const ed = SECTIONS.education.safeParse(form.education);
  if (ed.success) {
    const e = ed.data;
    if (!isSchool(instType)) {
      if (!e.level) out.push({ section: "education", step: "education", message: "level" });
      if (!e.schoolName) out.push({ section: "education", step: "education", message: "schoolName" });
      if (!e.year) out.push({ section: "education", step: "education", message: "year" });
      if (e.subjects.length < 1) out.push({ section: "education", step: "education", message: "subjects" });
    } else if (!ctx.isStandardOneEntry && !e.previousSchoolName && !e.previousSchoolId) {
      out.push({ section: "education", step: "education", message: "previousSchoolName" });
    }
  }
  return out;
}

export const academicDocKinds = ["MSCE", "JCE", "PSLCE", "IGCSE", "A_LEVEL", "TRANSCRIPT", "SCHOOL_REPORT", "OTHER_CERT"];
