import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { letterPdf } from "../src/lib/letterPdf.js";
import { DEFAULT_TEMPLATES_BY_LANG, renderLetter } from "../src/lib/letters.js";

const hasPoppler = spawnSync("pdftotext", ["-v"]).status !== null;

test("letters embed a real font and keep Chitumbuka/Chichewa characters (ŵ etc.)", { skip: !hasPoppler }, async () => {
  const vars = { "student.fullName": "Mphatso Ŵalira", "program.title": "BSc Computer Science", "institution.name": "Zomba Demo University", date: "2026-10-05", signatory: "The Registrar" };
  for (const lang of ["en", "ny", "tum"] as const) {
    const text = renderLetter(DEFAULT_TEMPLATES_BY_LANG[lang].ACCEPTANCE, vars);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "letter-")), "l.pdf");
    fs.writeFileSync(file, await letterPdf("Zomba Demo University", text));
    const out = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" }).replace(/\s+/g, " "); // long lines wrap in the PDF
    assert.ok(out.includes("Mphatso Ŵalira"), `${lang}: student name with ŵ must survive`);
    assert.ok(out.includes("BSc Computer Science"));
    assert.ok(/DejaVu/.test(execFileSync("pdffonts", [file], { encoding: "utf8" })), `${lang}: font must be embedded`);
  }
});
