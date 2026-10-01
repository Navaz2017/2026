// Placeholder substitution only — no template code execution, so institution-authored templates cannot
// run code or read other data. Unknown placeholders render empty. Output is PLAIN TEXT (PDF / WhatsApp / email);
// use renderLetterHtml if it is ever put in an HTML page.
const sub = (template: string, vars: Record<string, string>, f: (s: string) => string = (s) => s) =>
  template.replace(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g, (_, k: string) => f(vars[k] ?? ""));

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const renderLetter = (template: string, vars: Record<string, string>) => sub(template, vars);
export const renderLetterHtml = (template: string, vars: Record<string, string>) => sub(esc(template), vars, esc); // escape template text and values exactly once

export type Lang = "en" | "ny" | "tum";
export const isLang = (l: string): l is Lang => l === "en" || l === "ny" || l === "tum";

// Defaults used when the institution has not customised its own. NOTE: ny/tum wording must be reviewed
// by native speakers before launch (see docs/i18n.md).
export const DEFAULT_TEMPLATES_BY_LANG: Record<Lang, { ACCEPTANCE: string; REJECTION: string }> = {
  en: {
    ACCEPTANCE: "Dear {{student.fullName}},\n\nWe are pleased to offer you a place on {{program.title}} at {{institution.name}}.\n\nDate: {{date}}\n\nYours sincerely,\n{{signatory}}",
    REJECTION: "Dear {{student.fullName}},\n\nThank you for applying to {{program.title}} at {{institution.name}}. We regret that we are unable to offer you a place at this time.\n\nDate: {{date}}\n\nYours sincerely,\n{{signatory}}",
  },
  ny: {
    ACCEPTANCE: "Wokondedwa {{student.fullName}},\n\nTikusangalala kukudziwitsani kuti mwalandiridwa pa maphunziro a {{program.title}} ku {{institution.name}}.\n\nTsiku: {{date}}\n\nOmwe ali nanu,\n{{signatory}}",
    REJECTION: "Wokondedwa {{student.fullName}},\n\nTikuthokoza chifukwa chofunsira maphunziro a {{program.title}} ku {{institution.name}}. Tikupepesa kuti pakadali pano sitingakupatseni malo.\n\nTsiku: {{date}}\n\nOmwe ali nanu,\n{{signatory}}",
  },
  tum: {
    ACCEPTANCE: "Mwaŵanangwa {{student.fullName}},\n\nTikukondwa kumuziŵisani kuti mwalandirika pa sambiro la {{program.title}} ku {{institution.name}}.\n\nVuli: {{date}}\n\nMunyinu,\n{{signatory}}",
    REJECTION: "Mwaŵanangwa {{student.fullName}},\n\nTikuwonga chifukwa cha kupempha sambiro la {{program.title}} ku {{institution.name}}. Tikupepesa kuti pa nyengo iyi tikukwaniska yayi kumupa malo.\n\nVuli: {{date}}\n\nMunyinu,\n{{signatory}}",
  },
};
export const DEFAULT_TEMPLATES = DEFAULT_TEMPLATES_BY_LANG.en;
