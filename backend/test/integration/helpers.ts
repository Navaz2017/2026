import assert from "node:assert/strict";
import { prisma } from "../../src/db.js";

let refCounter = 0;
export type Call = (method: string, path: string, token?: string, body?: unknown) => Promise<Response>;

const personal = { surname: "Banda", firstName: "Test", gender: "M", dateOfBirth: "2005-02-02", nationality: "Malawian", nationalId: "AB123456", homeDistrict: "Zomba", physicalAddress: "Area 3, Zomba", phone: "0999123456" };

// A complete, valid set of form sections for either kind of institution.
export const sampleForm = (school: boolean, mode = "FULL_TIME") => ({
  personal, specialNeeds: { hasDisability: false },
  education: school
    ? { previousSchoolName: "Chilomoni Primary", lastClassCompleted: "Standard 5" }
    : { level: "MSCE", schoolName: "Zomba Secondary", year: 2023, subjects: [{ subject: "English", grade: "2" }, { subject: "Mathematics", grade: "3" }] },
  status: { current: "STUDYING" }, guardian: { relationship: "PARENT", name: "Mayi Banda", phone: "0888111222" },
  study: { mode }, sponsor: { type: "PARENT", name: "Mayi Banda" },
  payment: { provider: "MPAMBA", reference: `TID${Date.now().toString(36)}${(++refCounter).toString(36)}`.toUpperCase(), payerPhone: "0881000000" }, // entered before submitting
  declaration: { accepted: true, signatureName: "Test Banda" },
});

export async function saveSections(call: Call, token: string, id: string, form: Record<string, unknown>) {
  for (const [name, data] of Object.entries(form)) {
    const r = await call("PUT", `/me/applications/${id}/section/${name}`, token, data);
    assert.equal(r.status, 200, `section ${name}: ${await r.clone().text()}`);
  }
}

// Drives the whole wizard through the API. Returns the submitted application (status PAYMENT_SUBMITTED, or AWAITING_PAYMENT with `awaitingPayment`).
export async function submitApplication(call: Call, token: string, studentId: string, programIds: string[], o: { school?: boolean; credentialIds?: string[]; mode?: string; skipDocs?: boolean; awaitingPayment?: boolean; payment?: { provider: string; reference: string; payerPhone?: string } } = {}) {
  const d = await call("POST", "/me/applications/draft", token, { studentId, programId: programIds[0] });
  assert.ok([200, 201].includes(d.status), `draft: ${await d.clone().text()}`);
  const app = (await d.json()) as any;
  if (programIds.length > 1) assert.equal((await call("PUT", `/me/applications/${app.id}/choices`, token, { programIds })).status, 200);
  await saveSections(call, token, app.id, sampleForm(!!o.school, o.mode));
  if (!o.skipDocs) {
    const ids = [...(o.credentialIds ?? [])];
    if (!o.school) {
      ids.push((await prisma.credential.create({ data: { studentId, kind: "ID", title: "National ID", storageKey: `students/${studentId}/creds/id-${app.id}`, sha256: "0".repeat(64), mime: "application/pdf" } })).id);
      if (!o.credentialIds?.length) ids.push((await prisma.credential.create({ data: { studentId, kind: "MSCE", title: "MSCE", storageKey: `students/${studentId}/creds/msce-${app.id}`, sha256: "0".repeat(64), mime: "application/pdf" } })).id);
    } else if (!o.credentialIds?.length) {
      ids.push((await prisma.credential.create({ data: { studentId, kind: "SCHOOL_REPORT", title: "Report", storageKey: `students/${studentId}/creds/rep-${app.id}`, sha256: "0".repeat(64), mime: "application/pdf" } })).id);
    }
    assert.equal((await call("PUT", `/me/applications/${app.id}/documents`, token, { credentialIds: ids })).status, 200);
  }
  if (o.payment) assert.equal((await call("PUT", `/me/applications/${app.id}/section/payment`, token, { payerPhone: "0881000000", ...o.payment })).status, 200);
  const s = await call("POST", `/me/applications/${app.id}/submit`, token);
  assert.equal(s.status, 200, `submit: ${await s.clone().text()}`);
  // Simulates "payment was rejected, the applicant must pay again" (the older two-step flow still exists for that case).
  if (o.awaitingPayment) { await prisma.payment.deleteMany({ where: { applicationId: app.id } }); await prisma.application.update({ where: { id: app.id }, data: { status: "AWAITING_PAYMENT" } }); }
  return (await s.json()) as { id: string; totalDueMinor: number; commissionMinor: number; studentServiceFeeMinor: number; feeMinor: number; status: string };
}
