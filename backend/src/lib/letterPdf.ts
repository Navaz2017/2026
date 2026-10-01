import PDFDocument from "pdfkit";

// Simple A4 letter: institution name as letterhead, body text, signatory. Logo support: TODO(letterhead image).
export function letterPdf(institutionName: string, text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 64, info: { Title: "Application decision", Producer: "Enrolla" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c)).on("end", () => resolve(Buffer.concat(chunks))).on("error", reject);
    doc.font("Helvetica-Bold").fontSize(18).text(institutionName, { align: "center" });
    doc.moveDown(0.3).moveTo(64, doc.y).lineTo(531, doc.y).strokeColor("#888").stroke().moveDown(1.5);
    doc.font("Helvetica").fontSize(12).fillColor("#000").text(text, { lineGap: 4 });
    doc.end();
  });
}
