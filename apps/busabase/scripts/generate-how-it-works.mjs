#!/usr/bin/env node
// Render the "How It Works" flow diagram (apps/busabase/public/assets/readme/how-it-works.svg)
// shown in the README. Brand palette: cream + ink + teal, amber review gate, green
// approved path, muted-red reject. Run: node apps/busabase/scripts/generate-how-it-works.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const C = {
  ink: "#1a1714",
  sub: "#6b6358",
  rule: "#d9d3c6",
  teal: "#2f7a66",
  amberFill: "#fdf5e8",
  amberStroke: "#cf9f52",
  amberInk: "#8a5a13",
  greenFill: "#ecf6ef",
  greenStroke: "#4e9c6b",
  greenInk: "#1f6b3d",
  redFill: "#f8efed",
  redStroke: "#c08a82",
  redInk: "#9a4034",
  tanFill: "#f4f1ea",
  tanStroke: "#cfc7b6",
};

const V = {
  default: { fill: "#ffffff", stroke: C.rule, ink: C.ink },
  review: { fill: C.amberFill, stroke: C.amberStroke, ink: C.amberInk },
  approve: { fill: C.greenFill, stroke: C.greenStroke, ink: C.greenInk },
  reject: { fill: C.redFill, stroke: C.redStroke, ink: C.redInk },
  teal: { fill: "#eaf4f0", stroke: C.teal, ink: "#205a4c" },
  output: { fill: C.tanFill, stroke: C.tanStroke, ink: C.ink },
};

const esc = (s) => s.replace(/&/g, "&amp;");

function node(x, y, w, h, title, sub, variant = "default") {
  const v = V[variant];
  const cx = x + w / 2;
  const lines = Array.isArray(title) ? title : [title];
  const lineH = 23;
  const titleH = (lines.length - 1) * lineH;
  const subGap = 18;
  const top = y + h / 2 - (titleH + (sub ? subGap : 0)) / 2;
  const titleEls = lines
    .map(
      (ln, i) =>
        `<text x="${cx}" y="${top + i * lineH + 6}" text-anchor="middle" font-size="19" font-weight="700" fill="${v.ink}">${esc(ln)}</text>`,
    )
    .join("\n  ");
  const subEl = sub
    ? `\n  <text x="${cx}" y="${top + titleH + subGap + 6}" text-anchor="middle" font-size="13.5" fill="${C.sub}">${esc(sub)}</text>`
    : "";
  return `<g>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="13" fill="${v.fill}" stroke="${v.stroke}" stroke-width="1.6"/>
  ${titleEls}${subEl}
</g>`;
}

const mark = (id, color) =>
  `<marker id="${id}" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L7,3 L0,6 Z" fill="${color}"/></marker>`;

const arrow = (d, color, id) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" marker-end="url(#${id})"/>`;

const label = (x, y, text, color) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="13" font-weight="600" fill="${color}">${esc(text)}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="452" viewBox="0 0 1240 452" font-family="Helvetica,Arial,sans-serif">
<defs>
  <linearGradient id="card" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FCFBF8"/><stop offset="1" stop-color="#F4F1EA"/></linearGradient>
  ${mark("ink", C.ink)}${mark("green", C.greenStroke)}${mark("red", C.redStroke)}${mark("teal", C.teal)}
</defs>
<rect x="2" y="2" width="1236" height="448" rx="20" fill="url(#card)" stroke="#e7e1d5" stroke-width="1.5"/>

<!-- nodes -->
${node(40, 178, 168, 76, "Propose", "human or AI agent")}
${node(252, 178, 198, 76, "Change Request", "operations + commits")}
${node(492, 162, 140, 108, "Review", "human decides", "review")}
${node(674, 178, 120, 76, "Merge", "approved", "approve")}
${node(828, 152, 208, 124, ["Database &", "Knowledge Base"], "trusted · canonical · audited", "approve")}
${node(492, 56, 140, 56, "Rejected", "terminal", "reject")}
${node(452, 338, 210, 60, "ACP agent revises", "improves the proposal", "teal")}
${node(1064, 158, 158, 58, "Apps & agents", "Dashboard · API · MCP", "output")}
${node(1064, 232, 158, 58, "Automations", "webhooks · workflows", "output")}

<!-- main flow -->
${arrow("M208,216 L249,216", C.ink, "ink")}
${arrow("M450,216 L489,216", C.ink, "ink")}
${arrow("M632,216 L671,216", C.greenStroke, "green")}
${label(653, 205, "approve", C.greenInk)}
${arrow("M794,216 L827,216", C.greenStroke, "green")}

<!-- reject up -->
${arrow("M562,162 L562,115", C.redStroke, "red")}
${label(589, 140, "reject", C.redInk)}

<!-- revise loop: review -> ACP -> back to change request -->
${arrow("M548,270 L548,335", C.teal, "teal")}
${label(577, 305, "revise", C.teal)}
${arrow("M452,368 L351,368 L351,257", C.teal, "teal")}

<!-- database & knowledge base -> outputs -->
${arrow("M1036,196 L1063,187", C.ink, "ink")}
${arrow("M1036,240 L1063,257", C.ink, "ink")}
</svg>`;

// Keep the SVG as the editable source; embed the 2x PNG in the README (GitHub
// renders relative PNGs reliably, whereas raw SVGs can be served as text/plain).
const svgOut = path.join(appRoot, "public/assets/readme/how-it-works.svg");
const pngOut = path.join(appRoot, "public/assets/readme/how-it-works.png");
writeFileSync(svgOut, `${svg}\n`);
await sharp(Buffer.from(svg), { density: 144 }).png().toFile(pngOut);
console.log(`how-it-works → ${path.relative(process.cwd(), svgOut)} + .png (2x)`);
