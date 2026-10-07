import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

// PDF's built-in fonts cannot draw characters such as the Tumbuka "ŵ", so letters embed DejaVu Sans
// (free licence, covers Latin-extended: Chichewa, Chitumbuka, English). Found by walking up from this file,
// so it works from src/ (dev) and dist/src/ (built).
function fontDir() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++, dir = path.dirname(dir)) { const f = path.join(dir, "assets", "fonts"); if (fs.existsSync(path.join(f, "DejaVuSans.ttf"))) return f; }
  throw new Error("assets/fonts/DejaVuSans.ttf not found");
}

export function letterPdf(institutionName: string, text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const fonts = fontDir();
    const doc = new PDFDocument({ size: "A4", margin: 64, info: { Title: "Application decision", Producer: "Enrolla" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c)).on("end", () => resolve(Buffer.concat(chunks))).on("error", reject);
    doc.font(path.join(fonts, "DejaVuSans-Bold.ttf")).fontSize(17).text(institutionName, { align: "center" });
    doc.moveDown(0.3).moveTo(64, doc.y).lineTo(531, doc.y).strokeColor("#888").stroke().moveDown(1.5);
    doc.font(path.join(fonts, "DejaVuSans.ttf")).fontSize(11).fillColor("#000").text(text, { lineGap: 4 });
    doc.end();
  });
}
