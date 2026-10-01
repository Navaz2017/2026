// Single source of truth: shared/i18n/{en,ny,tum}.json.  `node shared/i18n/sync.mjs` checks them and copies to web + mobile.
// CI should run this and fail on non-zero exit. Exit 1 if any language is missing a key, has an empty value,
// has extra keys, or uses different {placeholders} than English.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const langs = ["en", "ny", "tum"];
const data = Object.fromEntries(langs.map((l) => [l, JSON.parse(fs.readFileSync(path.join(dir, `${l}.json`), "utf8"))]));
const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
let bad = 0;
for (const l of langs.slice(1)) {
  for (const k of Object.keys(data.en)) {
    if (!(k in data[l])) { console.error(`[${l}] missing: ${k}`); bad++; }
    else if (!data[l][k].trim()) { console.error(`[${l}] empty: ${k}`); bad++; }
    else if (ph(data[l][k]) !== ph(data.en[k])) { console.error(`[${l}] placeholder mismatch: ${k}`); bad++; }
  }
  for (const k of Object.keys(data[l])) if (!(k in data.en)) { console.error(`[${l}] extra key: ${k}`); bad++; }
}
if (bad) { console.error(`${bad} problem(s)`); process.exit(1); }
for (const target of ["../../web/src/i18n", "../../mobile/src/i18n"]) {
  const out = path.join(dir, target);
  fs.mkdirSync(out, { recursive: true });
  for (const l of langs) fs.copyFileSync(path.join(dir, `${l}.json`), path.join(out, `${l}.json`));
}
console.log(`i18n OK: ${Object.keys(data.en).length} keys x ${langs.length} languages -> web, mobile`);
