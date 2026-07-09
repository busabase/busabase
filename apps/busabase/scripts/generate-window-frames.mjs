#!/usr/bin/env node
// Wrap the raw screenshots in a clean macOS-window chrome (traffic-light dots +
// title bar + soft shadow) for the README and docs. Raw captures live in
// *-raw/ folders (written by capture-readme-screenshots.mjs); the framed
// versions keep the same basename.
//
// Two jobs:
//   public/assets/readme/desktop-raw/   → public/assets/readme/            (titled, lossless .webp)
//   public/assets/readme/scenarios-raw/ → public/assets/readme/scenarios/  (dots only, .png)
//
// Run: node apps/busabase/scripts/generate-window-frames.mjs
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readmeDir = path.join(appRoot, "public/assets/readme");

// Each job frames every screenshot in `raw` and writes it to `out` under the
// same filename. `titled` jobs show the per-file window title from `titles`.
const jobs = [
  // README/docs shots → lossless WebP (crisp UI text, ~⅓ the size of PNG).
  { raw: path.join(readmeDir, "desktop-raw"), out: readmeDir, titled: true, webp: true },
  // Scenario shots stay PNG — they're seeded as demo attachments that expect .png.
  {
    raw: path.join(readmeDir, "scenarios-raw"),
    out: path.join(readmeDir, "scenarios"),
    titled: false,
  },
];

// Optional title shown centered in the window bar, keyed by filename.
const titles = {
  "busabase-inbox-review.png": "Inbox — Change Requests",
  "busabase-agent-output-preview.png": "Change Request — Review",
  "busabase-record-detail-audit.png": "Record — History & Audit",
  "busabase-base-table.png": "Base",
  "busabase-base-records.png": "Base — Records",
  "busabase-graph-view.png": "Graph",
  "busabase-doc-detail.png": "Doc — Agent Operating Guide",
  "busabase-file-detail.png": "File — Product Brief",
};

// macOS chrome tokens (warm neutrals to match the cream/ink palette)
const barFill = "#edeae3";
const barEdge = "#dcd6ca";
const border = "#d2ccbe";
const titleInk = "#8a8175";
const dots = ["#ff5f57", "#febc2e", "#28c840"];

const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function frameOne(rawDir, outDir, file, titled, webp) {
  const inPath = path.join(rawDir, file);
  const meta = await sharp(inPath).metadata();
  const W = meta.width;
  const H = meta.height;

  const bar = Math.round(W * 0.034); // title-bar height
  const margin = Math.round(W * 0.02); // breathing room for the shadow
  const radius = Math.round(W * 0.012);
  const dotR = Math.round(bar * 0.16);
  const dotY = margin + Math.round(bar / 2);
  const dotX0 = margin + Math.round(bar * 0.62);
  const dotGap = Math.round(dotR * 3.4);

  const canvasW = W + margin * 2;
  const canvasH = bar + H + margin * 2;
  const winX = margin;
  const winY = margin;
  const winW = W;
  const winH = bar + H;
  const shotY = margin + bar;

  const img64 = readFileSync(inPath).toString("base64");
  const ext = /\.jpe?g$/i.test(file) ? "jpeg" : "png";
  const title = titled ? (titles[file] ?? "") : "";

  const dotEls = dots
    .map((c, i) => `<circle cx="${dotX0 + i * dotGap}" cy="${dotY}" r="${dotR}" fill="${c}"/>`)
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">
  <defs>
    <clipPath id="shot"><rect x="${winX}" y="${shotY}" width="${winW}" height="${H}" rx="${radius}" ry="${radius}"/></clipPath>
    <clipPath id="win"><rect x="${winX}" y="${winY}" width="${winW}" height="${winH}" rx="${radius}" ry="${radius}"/></clipPath>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${Math.round(W * 0.009)}"/>
      <feOffset dy="${Math.round(W * 0.005)}" result="off"/>
      <feFlood flood-color="#1a1714" flood-opacity="0.18"/>
      <feComposite in2="off" operator="in"/>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <rect x="${winX}" y="${winY}" width="${winW}" height="${winH}" rx="${radius}" ry="${radius}" fill="${barFill}"/>
  </g>
  <g clip-path="url(#win)">
    <rect x="${winX}" y="${winY}" width="${winW}" height="${bar}" fill="${barFill}"/>
    <rect x="${winX}" y="${winY + bar - 1}" width="${winW}" height="1" fill="${barEdge}"/>
    ${dotEls}
    ${title ? `<text x="${winX + winW / 2}" y="${winY + bar / 2}" text-anchor="middle" dominant-baseline="central" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="${Math.round(bar * 0.42)}" font-weight="600" fill="${titleInk}">${xmlEscape(title)}</text>` : ""}
    <image x="${winX}" y="${shotY}" width="${winW}" height="${H}" href="data:image/${ext};base64,${img64}"/>
  </g>
  <rect x="${winX + 0.5}" y="${winY + 0.5}" width="${winW - 1}" height="${winH - 1}" rx="${radius}" ry="${radius}" fill="none" stroke="${border}" stroke-width="1.5"/>
</svg>`;

  const out = path.join(outDir, webp ? file.replace(/\.(png|jpe?g)$/i, ".webp") : file);
  // Default density (72) renders the SVG 1:1, keeping the embedded screenshot at
  // its native resolution (no upscale blur on the screenshot text).
  const rendered = sharp(Buffer.from(svg));
  await (webp ? rendered.webp({ lossless: true }) : rendered.png()).toFile(out);
  console.log(`framed → ${path.relative(process.cwd(), out)}  (${W}×${H})`);
}

for (const job of jobs) {
  const rel = path.relative(process.cwd(), job.raw);
  if (!existsSync(job.raw)) {
    mkdirSync(job.raw, { recursive: true });
    console.log(`Created ${rel} — raw captures go here, then re-run.`);
    continue;
  }
  mkdirSync(job.out, { recursive: true });
  const files = readdirSync(job.raw).filter((f) => /\.(png|jpe?g)$/i.test(f));
  if (files.length === 0) {
    console.log(`No raw screenshots in ${rel}.`);
    continue;
  }
  console.log(`\n${rel} → framing ${files.length}…`);
  for (const f of files.sort()) await frameOne(job.raw, job.out, f, job.titled, job.webp);
}
