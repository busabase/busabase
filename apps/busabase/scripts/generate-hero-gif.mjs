#!/usr/bin/env node
// Build the README hero animation `public/assets/readme/busabase-hero.gif` by
// cross-fading through the macOS-window-framed product screenshots (the same
// titled PNGs generate-window-frames.mjs writes to public/assets/readme/).
//
// Regenerate after the screenshots change (e.g. re-framed, restyled):
//   node apps/busabase/scripts/generate-hero-gif.mjs
//
// Requires ffmpeg on PATH (macOS: `brew install ffmpeg`). Pure dev tool — not
// run in CI; the committed .gif is the artifact.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readmeDir = path.join(appRoot, "public/assets/readme");
const out = path.join(readmeDir, "busabase-hero.gif");

// Story order, matching the README narrative (Inbox → Review → Audit → Base).
// Each is a 1332×896 framed screenshot; held ~1.8s with a 0.25s cross-fade.
const frames = [
  "busabase-inbox-review.png",
  "busabase-agent-output-preview.png",
  "busabase-record-detail-audit.png",
  "busabase-base-table.png",
];

const W = 820;
const H = 551; // 1332×896 scaled to width 820 keeps the framed aspect (1.486)
const FPS = 8;
const HOLD = 1.8; // seconds each screenshot is on screen (incl. the fade tail)
const FADE = 0.25; // cross-fade duration
const COLORS = 96; // gif palette — text stays crisp, file stays ~3 MB

for (const f of frames) {
  const p = path.join(readmeDir, f);
  if (!existsSync(p)) {
    console.error(`generate-hero-gif: missing ${path.relative(process.cwd(), p)}`);
    process.exit(1);
  }
}

const inputs = frames.flatMap((f, i) => [
  "-loop",
  "1",
  "-t",
  // give the last clip a touch longer so the loop doesn't snap off the fade
  i === frames.length - 1 ? String(HOLD + 0.2) : String(HOLD),
  "-i",
  path.join(readmeDir, f),
]);

// Scale + fps each input, then chain xfades; offsets accumulate by (HOLD - FADE).
const scaled = frames.map((_, i) => `[${i}:v]scale=${W}:${H},fps=${FPS},setsar=1[v${i}]`).join(";");
let chain = "";
let prev = "v0";
for (let i = 1; i < frames.length; i++) {
  const offset = (HOLD - FADE) * i;
  const label = i === frames.length - 1 ? "xf" : `x${i}`;
  chain += `;[${prev}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(2)}[${label}]`;
  prev = label;
}
const filter =
  `${scaled}${chain};` +
  `[xf]split[s0][s1];[s0]palettegen=max_colors=${COLORS}:stats_mode=full[p];` +
  `[s1][p]paletteuse=dither=bayer:bayer_scale=5[out]`;

const args = ["-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-loop", "0", out];

const res = spawnSync("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
if (res.status !== 0) {
  console.error("generate-hero-gif: ffmpeg failed (is it installed?)");
  process.exit(res.status ?? 1);
}
console.log(`hero gif → ${path.relative(process.cwd(), out)}`);
