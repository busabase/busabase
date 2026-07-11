/**
 * Drive Grep Retrieval demo fixture — a small binary (PDF) asset seeded
 * alongside realistic "externally extracted" text, supplied through the real
 * `putText` code path (see `logic/seed.ts`'s `seedGrepDemoFixture`) exactly
 * the way an agent would after running its own extractor. Busabase never
 * parses PDFs — see the spec's "no extraction library, ever" boundary — so
 * this file only builds bytes that LOOK like a PDF; it does not read one.
 */

/** Minimal, well-formed single-page PDF (correct xref table, opens in a real viewer). */
export const buildMinimalPdfBuffer = (): Buffer => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const streamContent =
    "BT /F1 16 Tf 72 720 Td (Globex Cloud Services - Invoice INV-GCX-DEMO-0001) Tj ET";
  const streamObject = `<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream`;

  const header = "%PDF-1.4\n";
  let body = "";
  const offsets: number[] = [];
  let cursor = Buffer.byteLength(header, "latin1");

  const allObjects = [...objects, streamObject];
  allObjects.forEach((content, index) => {
    offsets.push(cursor);
    const chunk = `${index + 1} 0 obj\n${content}\nendobj\n`;
    body += chunk;
    cursor += Buffer.byteLength(chunk, "latin1");
  });

  const xrefStart = cursor;
  const objectCount = allObjects.length + 1;
  let xref = `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(header + body + xref + trailer, "latin1");
};

/** Fixed slug/id-friendly file name for the seeded fixture. */
export const GREP_DEMO_FIXTURE_FILE_NAME = "globex-cloud-invoice-2026-06-demo.pdf";

/**
 * Realistic "externally extracted" text an agent's own PDF-extraction tool
 * would have produced — simulating exactly what `putText` is FOR. Mentions
 * terms that mirror the spec's own worked examples ("find the termination
 * clause", "which rows mention ACME Corp") so the demo scenario in the spec's
 * roadmap ("agent greps a string in the fixture, reads the surrounding
 * lines...") is concretely reproducible.
 */
export const GREP_DEMO_EXTRACTED_TEXT = `Globex Cloud Services
Invoice INV-GCX-DEMO-0001

Bill To: ACME Corp
Billing Period: 2026-05-01 to 2026-05-31
Purchase Order: PO-2026-0472

Line Items:
  Compute (vCPU-hours)         42,300 units    $ 84,600.00
  Storage (TB-months)             120 units    $ 12,000.00
  Support Plan (Enterprise)         1 unit      $ 21,800.00
  Subtotal                                     $118,400.00
  Tax (8%)                                     $  9,472.00
  Total Due                                    $127,872.00

Payment Terms: Net 30 from invoice date.

Termination Clause:
Either party may terminate this agreement for convenience with 60 days
written notice. Upon termination, ACME Corp remains liable for all
charges incurred through the effective termination date. Early
termination for cause (material breach uncured after 15 days) permits
immediate suspension of services by Globex Cloud Services.

Notes for AP review: OCR matched vendor, PO number, billing period, and
subtotal against PO-2026-0472. Tax line requires finance approval before
payment is released. Contact billing@globexcloud.example for questions
regarding ACME Corp's account.
`;
