#!/usr/bin/env node
// Render the GitHub social-preview card (1280x640) used for repo link unfurls
// (X / Slack / Discord / LinkedIn / …). Upload the output at the repo's
// Settings → General → Social preview. Run: node apps/busabase/scripts/generate-social-preview.mjs
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const icon = await sharp(await readFile(path.join(appRoot, "public/icon.svg")))
  .resize(92, 92)
  .png()
  .toBuffer();

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
  <rect width="1280" height="640" fill="#f6f7f5"/>
  <rect width="14" height="640" fill="#171717"/>

  <text x="202" y="134" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700" fill="#171717">Busabase</text>
  <text x="88" y="258" font-family="Arial, Helvetica, sans-serif" font-size="61" font-weight="700" fill="#171717">Database &amp; Workspace</text>
  <text x="88" y="329" font-family="Arial, Helvetica, sans-serif" font-size="61" font-weight="700" fill="#171717">for AI Agents</text>
  <text x="88" y="390" font-family="Arial, Helvetica, sans-serif" font-size="27" fill="#595d58">One operational home for agent work.</text>

  <rect x="816" y="74" width="376" height="436" rx="8" fill="#ffffff" stroke="#d7dad5" stroke-width="2"/>
  <text x="856" y="124" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="700" fill="#5e655f">ONE WORKSPACE</text>
  <rect x="856" y="153" width="296" height="1" fill="#d7dad5"/>
  <circle cx="868" cy="194" r="6" fill="#2f7a66"/>
  <text x="892" y="202" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="600" fill="#171717">Structured data</text>
  <circle cx="868" cy="258" r="6" fill="#4d6f9f"/>
  <text x="892" y="266" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="600" fill="#171717">Durable knowledge</text>
  <circle cx="868" cy="322" r="6" fill="#9a6a32"/>
  <text x="892" y="330" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="600" fill="#171717">Reusable skills</text>
  <circle cx="868" cy="386" r="6" fill="#7a5688"/>
  <text x="892" y="394" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="600" fill="#171717">Runnable apps</text>
  <circle cx="868" cy="450" r="6" fill="#a54b45"/>
  <text x="892" y="458" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="600" fill="#171717">Human-reviewed changes</text>

  <rect x="88" y="464" width="642" height="1" fill="#d7dad5"/>
  <text x="88" y="505" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="600" fill="#2f7a66">OPEN SOURCE · LOCAL-FIRST · SELF-HOSTABLE</text>
  <rect x="88" y="545" width="1104" height="1" fill="#d7dad5"/>
  <text x="88" y="594" font-family="Menlo, Consolas, monospace" font-size="23" fill="#595d58">github.com/busabase/busabase</text>
  <text x="1192" y="594" text-anchor="end" font-family="Menlo, Consolas, monospace" font-size="23" font-weight="700" fill="#171717">npx busabase server</text>
</svg>`;

const out = path.join(appRoot, "public/assets/readme/busabase-social-preview.png");
await sharp(Buffer.from(svg))
  .composite([{ input: icon, left: 88, top: 68 }])
  .png({ compressionLevel: 9, palette: true })
  .toFile(out);
console.log(`social preview → ${path.relative(process.cwd(), out)}`);
