// Normalise Malawian numbers to E.164 (+265...). Accepts 0999..., 999..., +265999..., 265999...
export function normalisePhone(raw: string): string | null {
  const d = raw.replace(/[^\d+]/g, "");
  const digits = d.startsWith("+") ? d.slice(1) : d;
  let national: string;
  if (digits.startsWith("265")) national = digits.slice(3);
  else if (digits.startsWith("0")) national = digits.slice(1);
  else national = digits;
  return /^[89]\d{8}$/.test(national) ? `+265${national}` : null;
}
