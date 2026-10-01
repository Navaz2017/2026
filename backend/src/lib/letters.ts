// Placeholder substitution with HTML escaping — no template code execution, so institution-authored
// templates cannot inject script or read other data. Unknown placeholders render empty.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderLetter(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g, (_, k: string) => esc(vars[k] ?? ""));
}

export const DEFAULT_TEMPLATES = {
  ACCEPTANCE:
    "Dear {{student.fullName}},\n\nWe are pleased to offer you a place on {{program.title}} at {{institution.name}}.\n\nDate: {{date}}\n\nYours sincerely,\n{{signatory}}",
  REJECTION:
    "Dear {{student.fullName}},\n\nThank you for applying to {{program.title}} at {{institution.name}}. We regret that we are unable to offer you a place at this time.\n\nDate: {{date}}\n\nYours sincerely,\n{{signatory}}",
} as const;
