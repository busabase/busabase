#!/usr/bin/env node
// Render the GitHub social-preview card (1280x640) used for repo link unfurls
// (X / Slack / Discord / LinkedIn / …). Upload the output at the repo's
// Settings → General → Social preview. Run: node apps/busabase/scripts/generate-social-preview.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const icon = readFileSync(path.join(appRoot, "public/icon.svg"), "utf8");
const lotus = icon.match(/<path d="([^"]+)"/)[1];

const ink = "#1a1714";
const sub = "#6b6358";
const accent = "#2f7a66";
const cream0 = "#FCFBF8";
const cream1 = "#F1EEE6";
const rule = "#d9d3c6";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${cream0}"/><stop offset="1" stop-color="${cream1}"/></linearGradient></defs>
  <rect width="1280" height="640" fill="url(#bg)"/>
  <rect width="1280" height="8" fill="${accent}"/>
  <g transform="translate(845,158) scale(0.6)" fill="${ink}" opacity="0.05"><path d="${lotus}"/></g>
  <g transform="translate(96,84) scale(0.1)" fill="${ink}"><path d="${lotus}"/></g>
  <text x="222" y="176" font-family="Georgia, serif" font-size="70" font-weight="700" fill="${ink}">Busabase</text>
  <text x="96" y="312" font-family="Helvetica, Arial, sans-serif" font-size="52" font-weight="700" fill="${ink}">The approval-first database</text>
  <text x="96" y="374" font-family="Helvetica, Arial, sans-serif" font-size="52" font-weight="700" fill="${ink}">&amp; knowledge base for AI agents.</text>
  <text x="96" y="434" font-family="Helvetica, Arial, sans-serif" font-size="31" fill="${sub}">Every change gets human review before it becomes a record you can trust.</text>
  <text x="96" y="498" font-family="Helvetica, Arial, sans-serif" font-size="25" font-weight="600" fill="${accent}">Open source (MIT)  ·  Local-first  ·  Self-hosted  ·  Desktop · CLI · REST API</text>
  <rect x="96" y="548" width="1088" height="1.5" fill="${rule}"/>
  <text x="96" y="594" font-family="Menlo, monospace" font-size="24" fill="${sub}">github.com/busabase/busabase</text>
  <text x="1184" y="594" text-anchor="end" font-family="Menlo, monospace" font-size="24" fill="${sub}">npx busabase server</text>
</svg>`;

const out = path.join(appRoot, "public/assets/readme/busabase-social-preview.png");
await sharp(Buffer.from(svg)).png().toFile(out);
console.log(`social preview → ${path.relative(process.cwd(), out)}`);
