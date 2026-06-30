#!/usr/bin/env node
// Generate a self-contained coverage SVG badge (no external service) from the
// vitest v8 coverage-summary.json. Scope = server-side business logic (logic/ +
// domains/, excluding the React dashboard UI) — see the `coverage:badge` script.
// Regenerate with: pnpm --filter busabase-core coverage:badge
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const coreRoot = path.resolve(here, "..");
const repoRoot = path.resolve(coreRoot, "../..");

const summaryPath = path.join(coreRoot, "coverage", "coverage-summary.json");
const outPath = path.join(
  repoRoot,
  "apps",
  "busabase",
  "public",
  "assets",
  "readme",
  "coverage.svg",
);

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const pct = Math.round((summary.total?.lines?.pct ?? 0) * 10) / 10;

const color =
  pct >= 90
    ? "#4c1"
    : pct >= 80
      ? "#97ca00"
      : pct >= 70
        ? "#a4a61d"
        : pct >= 60
          ? "#dfb317"
          : pct >= 50
            ? "#fe7d37"
            : "#e05d44";

const label = "coverage";
const value = `${pct}%`;
// Rough text widths (6px/char + side padding) — matches the flat shields layout.
const charW = 6.5;
const lw = Math.ceil(label.length * charW) + 10;
const vw = Math.ceil(value.length * charW) + 12;
const total = lw + vw;
const lx = (lw / 2) * 10;
const vx = (lw + vw / 2) * 10;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${total}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${lx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(lw - 10) * 10}">${label}</text>
    <text x="${lx}" y="140" transform="scale(.1)" fill="#fff" textLength="${(lw - 10) * 10}">${label}</text>
    <text aria-hidden="true" x="${vx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(vw - 12) * 10}">${value}</text>
    <text x="${vx}" y="140" transform="scale(.1)" fill="#fff" textLength="${(vw - 12) * 10}">${value}</text>
  </g>
</svg>
`;

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, svg, "utf8");
console.log(
  `[coverage-badge] ${label} ${value} (color ${color}) → ${path.relative(repoRoot, outPath)}`,
);
