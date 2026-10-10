// Small, forgiving CSV reader for school uploads (Excel "Save as CSV" in any locale: comma or semicolon, quotes, CRLF, BOM).
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const records: string[][] = [];
  let cur: string[] = [], field = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { cur.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; cur.push(field); field = ""; if (cur.some((x) => x.trim() !== "")) records.push(cur); cur = []; }
    else field += c;
  }
  cur.push(field); if (cur.some((x) => x.trim() !== "")) records.push(cur);
  const headers = (records.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  return { headers, rows: records.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))) };
}

// Cells that start with = + - @ are executed by Excel when a CSV is opened: neutralise them in anything we hand back.
export const csvCell = (v: unknown) => { const s = String(v ?? ""); const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
