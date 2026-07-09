#!/usr/bin/env node
// Render the GitHub social-preview card (1280x640) used for repo link unfurls
// (X / Slack / Discord / LinkedIn / …). Upload the output at the repo's
// Settings → General → Social preview. Run: node apps/busabase/scripts/generate-social-preview.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ink = "#1a1714";
const sub = "#6b6358";
const accent = "#2f7a66";
const cream0 = "#FCFBF8";
const cream1 = "#F1EEE6";
const rule = "#d9d3c6";

const markPath =
  "M258 96H766C855.47 96 928 168.53 928 258V766C928 855.47 855.47 928 766 928H258C168.53 928 96 855.47 96 766V258C96 168.53 168.53 96 258 96ZM328.5 251C285.7 251 251 285.7 251 328.5C251 371.3 285.7 406 328.5 406H696.5C739.3 406 774 371.3 774 328.5C774 285.7 739.3 251 696.5 251H328.5ZM328.5 435C285.7 435 251 469.7 251 512.5C251 555.3 285.7 590 328.5 590H563.5C606.3 590 641 555.3 641 512.5C641 469.7 606.3 435 563.5 435H328.5ZM328.5 620C285.7 620 251 654.7 251 697.5C251 740.3 285.7 775 328.5 775H696.5C739.3 775 774 740.3 774 697.5C774 654.7 739.3 620 696.5 620H328.5Z";

const iconLayer = `
  <rect x="96" y="96" width="832" height="832" rx="162" fill="#171717"/>
  <rect x="251" y="251" width="523" height="155" rx="77.5" fill="#F8F8F7"/>
  <rect x="251" y="435" width="390" height="155" rx="77.5" fill="#F8F8F7"/>
  <rect x="251" y="620" width="523" height="155" rx="77.5" fill="#F8F8F7"/>
`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${cream0}"/><stop offset="1" stop-color="${cream1}"/></linearGradient></defs>
  <rect width="1280" height="640" fill="url(#bg)"/>
  <rect width="1280" height="8" fill="${accent}"/>
  <g transform="translate(760,74) scale(0.85)" fill="${ink}" opacity="0.05"><path d="${markPath}" fill-rule="evenodd"/></g>
  <g transform="translate(96,84) scale(0.1)">${iconLayer}</g>
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
