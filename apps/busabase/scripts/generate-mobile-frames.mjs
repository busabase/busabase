#!/usr/bin/env node
// Composite raw busabase-mobile screenshots into clean phone-bezel mockups for
// the README. Device-agnostic: each frame is built around the screenshot's own
// aspect ratio, so iPhone / Android / any resolution all work.
//
// 1. Capture screens in the simulator (or a real device).
// 2. Drop the raw PNGs into public/assets/readme/mobile-raw/ — any filenames.
// 3. Run: node apps/busabase/scripts/generate-mobile-frames.mjs
//    → writes <name>-framed.webp next to the other README assets.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = path.join(appRoot, "public/assets/readme/mobile-raw");
const outDir = path.join(appRoot, "public/assets/readme");

// Output frame width in px (displayed small in the README, retina-crisp).
const FRAME_W = 1080;
const bezel = "#15130f"; // near-black ink bezel — reads on light + dark GitHub
const ring = "#37322b"; // subtle highlight on the bezel edge

async function frameOne(file) {
  const inPath = path.join(rawDir, file);
  const meta = await sharp(inPath).metadata();
  const aspect = meta.height / meta.width;

  const pad = Math.round(FRAME_W * 0.035); // bezel thickness
  const screenW = FRAME_W - pad * 2;
  const screenH = Math.round(screenW * aspect);
  const frameH = screenH + pad * 2;
  const rOuter = Math.round(FRAME_W * 0.135);
  const rScreen = Math.round(screenW * 0.085);

  // Dynamic-island pill, centered near the top of the screen.
  const islandW = Math.round(screenW * 0.3);
  const islandH = Math.round(pad * 0.95);
  const islandX = pad + (screenW - islandW) / 2;
  const islandY = pad + Math.round(pad * 0.55);

  const img64 = readFileSync(inPath).toString("base64");
  const ext = /\.jpe?g$/i.test(file) ? "jpeg" : "png";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME_W}" height="${frameH}" viewBox="0 0 ${FRAME_W} ${frameH}">
  <defs>
    <clipPath id="screen"><rect x="${pad}" y="${pad}" width="${screenW}" height="${screenH}" rx="${rScreen}" ry="${rScreen}"/></clipPath>
  </defs>
  <rect x="1" y="1" width="${FRAME_W - 2}" height="${frameH - 2}" rx="${rOuter}" ry="${rOuter}" fill="${bezel}" stroke="${ring}" stroke-width="2"/>
  <image x="${pad}" y="${pad}" width="${screenW}" height="${screenH}" clip-path="url(#screen)" preserveAspectRatio="xMidYMid slice" href="data:image/${ext};base64,${img64}"/>
  <rect x="${islandX}" y="${islandY}" width="${islandW}" height="${islandH}" rx="${islandH / 2}" ry="${islandH / 2}" fill="#000"/>
</svg>`;

  const base = path.basename(file).replace(/\.(png|jpe?g)$/i, "");
  // q90 WebP — these framed shots have photographic bezels/gradients, where
  // lossy compresses far better than lossless with no visible loss.
  const out = path.join(outDir, `${base}-framed.webp`);
  await sharp(Buffer.from(svg), { density: 96 }).webp({ quality: 90 }).toFile(out);
  console.log(`framed → ${path.relative(process.cwd(), out)}  (${meta.width}×${meta.height})`);
}

if (!existsSync(rawDir)) {
  mkdirSync(rawDir, { recursive: true });
  console.log(
    `Created ${path.relative(process.cwd(), rawDir)} — drop raw screenshots there, then re-run.`,
  );
  process.exit(0);
}
const files = readdirSync(rawDir).filter((f) => /\.(png|jpe?g)$/i.test(f));
if (files.length === 0) {
  console.log(
    `No screenshots in ${path.relative(process.cwd(), rawDir)} yet — drop PNGs there, then re-run.`,
  );
  process.exit(0);
}
for (const f of files.sort()) await frameOne(f);
