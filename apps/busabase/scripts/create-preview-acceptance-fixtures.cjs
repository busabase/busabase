// Disposable real files for the opt-in PreviewFile modal acceptance matrix.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { zipSync, strToU8 } = require("fflate");
const XLSX = require("xlsx");
const sharp = require("sharp");
const initSqlJs = require("sql.js");
const target = process.argv[2];
if (!target || !path.resolve(target).startsWith("/tmp/"))
  throw new Error("Use a disposable /tmp/ output directory");

async function main() {
  await fs.mkdir(target, { recursive: true });
  const files = [];
  async function save(name, mimeType, bytes, type, marker) {
    await fs.writeFile(path.join(target, name), bytes);
    files.push({ name, mimeType, type, marker, path: path.join(target, name) });
  }
  const markdown =
    "# 审核报告 🧭\n\n中文与 emoji 🚀 保持原样。\n\n| 指标 | 数值 |\n| --- | --- |\n| 访问 | 550 |\n\n```ts\nconst greeting = '你好';\n```\n\n<script>window.previewExecuted = true</script>\n";
  await save("review-中文.MD", "image/png", Buffer.from(markdown), "markdown", "审核报告 🧭");
  await save(
    "report.json",
    "application/octet-stream",
    Buffer.from('{\n  "review": "统一预览 ✅",\n  "count": 550\n}\n'),
    "code",
    "统一预览 ✅",
  );
  await save(
    "source.html",
    "text/html",
    Buffer.from("<h1>Literal source</h1>\n<script>window.previewExecuted=true</script>"),
    "code",
    "Literal source",
  );
  await save("empty.md", "text/markdown", Buffer.from(""), "markdown", "empty");
  await save("invalid.md", "text/markdown", Buffer.from([255, 254, 0, 35]), "markdown", "UTF-8");
  await save("oversized.txt", "text/plain", Buffer.alloc(1024 * 1024 + 1, 65), "text", "1 MiB");
  const png = await sharp(
    Buffer.from(
      '<svg width="480" height="280"><rect width="480" height="280" fill="#e7ede8"/><circle cx="240" cy="120" r="70" fill="#356247"/><text x="85" y="245" font-size="24">PreviewFile image review</text></svg>',
    ),
  )
    .png()
    .toBuffer();
  await save("photo.png", "application/octet-stream", png, "image", "");
  await save(
    "scan.tiff",
    "application/octet-stream",
    await sharp(png).tiff({ compression: "none" }).toBuffer(),
    "tiff",
    "",
  );
  // A valid flattened RGB PSD, with three uncompressed planar channels.
  const psdHeader = Buffer.alloc(40);
  psdHeader.write("8BPS");
  psdHeader.writeUInt16BE(1, 4);
  psdHeader.writeUInt16BE(3, 12);
  psdHeader.writeUInt32BE(64, 14);
  psdHeader.writeUInt32BE(96, 18);
  psdHeader.writeUInt16BE(8, 22);
  psdHeader.writeUInt16BE(3, 24);
  await save(
    "design.psd",
    "application/octet-stream",
    Buffer.concat([
      psdHeader,
      Buffer.alloc(96 * 64, 53),
      Buffer.alloc(96 * 64, 98),
      Buffer.alloc(96 * 64, 71),
    ]),
    "psd",
    "",
  );
  await save(
    "captions.srt",
    "application/octet-stream",
    Buffer.from("1\n00:00:00,000 --> 00:00:01,500\n交付字幕 PreviewFile ✅\n\n"),
    "subtitle",
    "交付字幕 PreviewFile ✅",
  );
  const pdf = "%PDF-1.4\n";
  const stream = "BT /F1 22 Tf 40 120 Td (PreviewFile PDF review 550) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 220] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let content = pdf;
  const offsets = [0];
  for (const [i, o] of objects.entries()) {
    offsets.push(Buffer.byteLength(content));
    content += `${i + 1} 0 obj\n${o}\nendobj\n`;
  }
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await save("report.pdf", "text/plain", Buffer.from(content), "pdf", "PreviewFile PDF review 550");
  const workbook = XLSX.utils.book_new();
  for (const name of ["Summary", "Details"])
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["PreviewFile", name],
        ["Revenue", 550],
        ["负责人", "中文 ✅"],
      ]),
      name,
    );
  await save(
    "budget.xlsx",
    "text/plain",
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
    "spreadsheet",
    "Details",
  );
  const xml = (value) => strToU8(value);
  await save(
    "brief.docx",
    "application/octet-stream",
    Buffer.from(
      zipSync({
        "[Content_Types].xml": xml(
          '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        ),
        "_rels/.rels": xml(
          '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        ),
        "word/document.xml": xml(
          '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>PreviewFile Word review — 中文报告</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
        ),
      }),
    ),
    "word",
    "PreviewFile Word review",
  );
  await save(
    "bundle.zip",
    "application/zip",
    Buffer.from(
      zipSync({ "handoff.txt": xml("Archive review 550"), "notes/review.md": xml(markdown) }),
    ),
    "archive",
    "handoff.txt",
  );
  await save(
    "handbook.epub",
    "application/epub+zip",
    Buffer.from(
      zipSync({
        mimetype: [xml("application/epub+zip"), { level: 0 }],
        "META-INF/container.xml": xml(
          '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        ),
        "OEBPS/content.opf": xml(
          '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">preview-review</dc:identifier><dc:title>PreviewFile handbook</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-11-11T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>',
        ),
        "OEBPS/nav.xhtml": xml(
          '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Review chapter</a></li></ol></nav></body></html>',
        ),
        "OEBPS/chapter.xhtml": xml(
          '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Review</title></head><body><h1>PreviewFile EPUB review</h1><p>A real stored book is readable here.</p></body></html>',
        ),
      }),
    ),
    "epub",
    "PreviewFile EPUB review",
  );
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(
    "CREATE TABLE review (id INTEGER, title TEXT); INSERT INTO review VALUES (1, 'PreviewFile database 550');",
  );
  await save(
    "review.sqlite",
    "application/octet-stream",
    Buffer.from(db.export()),
    "sqlite",
    "PreviewFile database 550",
  );
  db.close();
  const stl =
    "solid review\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid review\n";
  await save("shape.stl", "model/stl", Buffer.from(stl), "model_3d", "");
  for (const [name, args, mime, type] of [
    ["voice.wav", ["-f", "lavfi", "-i", "sine=frequency=440:duration=1"], "audio/wav", "audio"],
    [
      "clip.mp4",
      [
        "-f",
        "lavfi",
        "-i",
        "color=c=0x356247:s=320x180:d=1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
      ],
      "video/mp4",
      "video",
    ],
  ]) {
    execFileSync(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", ...args, "-y", path.join(target, name)],
      {
        env: {
          ...process.env,
          ...(process.env.PREVIEW_FIXTURE_LIBRARY_PATH
            ? { DYLD_LIBRARY_PATH: process.env.PREVIEW_FIXTURE_LIBRARY_PATH }
            : {}),
        },
      },
    );
    files.push({ name, mimeType: mime, type, marker: "", path: path.join(target, name) });
  }
  const PptxGenJS = require("pptxgenjs");
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  const slide = deck.addSlide();
  slide.addText("PreviewFile Office conversion review", { x: 1, y: 1, w: 11, h: 1, fontSize: 28 });
  slide.addText("Revenue 550", { x: 1, y: 3, w: 8, h: 1, fontSize: 24 });
  await save(
    "slides.pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    await deck.write({ outputType: "nodebuffer" }),
    "presentation",
    "PreviewFile Office conversion review",
  );
  await save(
    "unknown.custom-binary",
    "application/octet-stream",
    Buffer.from([1, 2, 3, 4]),
    "unsupported",
    "",
  );
  await fs.writeFile(path.join(target, "manifest.json"), JSON.stringify(files, null, 2));
  console.log(path.join(target, "manifest.json"));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
