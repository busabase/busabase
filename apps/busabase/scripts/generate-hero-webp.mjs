#!/usr/bin/env node
// Build the README hero animations
//   public/assets/readme/busabase-hero.webp        (en, also reused by README_ko)
//   public/assets/readme/busabase-hero-zh-CN.webp  (zh-CN)
//   public/assets/readme/busabase-hero-ja.webp     (ja)
// by capturing the LIVE busabase-cloud homepage hero — a self-contained
// GSAP/React animation that cycles Change Request → Base table → Graph while an
// AI agent "drives" the workspace (apps/busabase-cloud/src/app/[lang]/(home)).
//
// The hero is fully localized, so we capture one WebP per locale and point each
// README at its own language.
//
// Prereqs:
//   1) Run the busabase-cloud dev server first (the hero must hydrate to play):
//        pnpm --filter busabase-cloud dev --port 3060
//      IMPORTANT: capture over http://localhost (NOT 127.0.0.1). Next.js 16
//      blocks cross-origin dev chunks from 127.0.0.1, so the page never hydrates
//      and the animation/clicks do nothing.
//   2) Tools: img2webp on PATH (macOS: `brew install webp`) + Playwright chromium
//      (installed at the repo root: `pnpm exec playwright install chromium`).
//
// Regenerate:
//   node apps/busabase/scripts/generate-hero-webp.mjs
//   BUSABASE_CLOUD_URL=http://localhost:3060 node apps/busabase/scripts/generate-hero-webp.mjs
//
// How it captures (deterministic, pixel-exact — no webm/ffmpeg rescale, which is
// what introduced the earlier sub-pixel offset/judder): it drives the three
// phases by clicking the step pills (reaching phase 0 from phase 2 so every phase
// plays its entrance), takes exact-clip page.screenshots of the workspace window,
// stamps each frame with its real on-screen duration, then thins the dense motion
// to ~20fps and holds one static frame per phase before encoding with img2webp.
//
// Pure dev tool — not run in CI; the committed .webp files are the artifact.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readmeDir = path.join(appRoot, "public/assets/readme");
const BASE = (process.env.BUSABASE_CLOUD_URL || "http://localhost:3060").replace(/\/$/, "");

// locale route → output filename. English is the default `busabase-hero.webp`
// (reused by README_ko, since busabase-cloud has no `ko` locale).
const LOCALES = [
  { path: "en", out: "busabase-hero.webp" },
  { path: "zh-CN", out: "busabase-hero-zh-CN.webp" },
  { path: "ja", out: "busabase-hero-ja.webp" },
];

// The workspace window inside the hero (two-pane rounded card), sized so the full
// 610px-tall window clears the 56px sticky site header in the recorded frame.
const VW = 1320;
const VH = 700;
const TOP_PAD = 72;
const WIN_SELECTOR = "div.overflow-hidden.rounded-2xl.text-left.shadow-2xl";
const PILL_SELECTOR = "div.mt-4.flex.flex-wrap.justify-center.gap-2 > button";
const MOTION_MS = 1500; // dense-capture window after each phase change
const HOLD_MS = 1500; // static dwell shown before advancing
const SETTLE_MS = 900; // let a phase fully settle
const TARGET_MS = 50; // ~20fps for motion after thinning
const HOLD_MIN = 400; // frames >= this are the static hold frames (always kept)
const QUALITY = 72;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture(localePath, dir) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/${localePath}`, { waitUntil: "networkidle", timeout: 60000 });

  const win = page.locator(WIN_SELECTOR).first();
  await win.waitFor({ state: "visible", timeout: 30000 });
  await sleep(1600); // hydration + first-mount settle

  // Pin the window at a fixed offset below the sticky header (its natural
  // position varies with viewport height due to min-h-screen centering).
  await win.evaluate((el, pad) => {
    const r = el.getBoundingClientRect();
    window.scrollBy(0, r.top - pad);
  }, TOP_PAD);
  await sleep(300);
  const bb = await win.boundingBox();
  const box = {
    x: Math.round(bb.x),
    y: Math.round(bb.y),
    width: Math.round(bb.width),
    height: Math.round(bb.height),
  };

  const pills = page.locator(PILL_SELECTOR);
  const clickPill = (i) => pills.nth(i).evaluate((el) => el.click());

  const frames = [];
  let idx = 0;
  const shoot = async (ms) => {
    const file = path.join(dir, `f_${String(idx).padStart(4, "0")}.png`);
    await page.screenshot({ path: file, clip: box, animations: "allow" });
    frames.push({ file, ms });
    idx++;
  };

  // Warm up to phase 2 (no capture) so the first captured phase (0) is reached
  // FROM 2 and thus plays its entrance animation.
  await clickPill(2);
  await sleep(SETTLE_MS + 400);

  for (const p of [0, 1, 2]) {
    await clickPill(p);
    const start = Date.now();
    let prev = start;
    await shoot(0);
    let last = frames.length - 1;
    while (Date.now() - start < MOTION_MS) {
      await shoot(0);
      const now = Date.now();
      frames[last].ms = now - prev; // duration the PREVIOUS frame was shown
      prev = now;
      last = frames.length - 1;
    }
    frames[last].ms = Math.max(40, Date.now() - prev);
    await sleep(Math.max(0, SETTLE_MS - MOTION_MS));
    await shoot(HOLD_MS); // one long static hold frame
  }

  await browser.close();
  return frames;
}

function encode(frames, out) {
  // Thin dense motion toward TARGET_MS (merging dropped frames' durations into
  // the kept frame so total timing is preserved); always keep the hold frames.
  const kept = [];
  let acc = 0;
  for (const f of frames) {
    if (f.ms >= HOLD_MIN) {
      if (kept.length) {
        kept[kept.length - 1].ms += acc;
        acc = 0;
      }
      kept.push({ ...f });
      continue;
    }
    acc += f.ms;
    if (acc >= TARGET_MS) {
      kept.push({ file: f.file, ms: acc });
      acc = 0;
    }
  }
  if (acc > 0 && kept.length) kept[kept.length - 1].ms += acc;

  const args = ["-loop", "0", "-lossy", "-q", String(QUALITY), "-m", "6"];
  for (const f of kept) args.push("-d", String(Math.round(f.ms)), f.file);
  args.push("-o", out);
  try {
    execFileSync("img2webp", args, { stdio: ["ignore", "ignore", "inherit"] });
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error(
        "generate-hero-webp: `img2webp` not found — install it with `brew install webp`.",
      );
      process.exit(1);
    }
    throw err;
  }
  return kept.length;
}

for (const loc of LOCALES) {
  const dir = mkdtempSync(path.join(tmpdir(), `busabase-hero-${loc.path.replace(/\W/g, "-")}-`));
  try {
    const frames = await capture(loc.path, dir);
    const out = path.join(readmeDir, loc.out);
    const n = encode(frames, out);
    console.log(`hero ${loc.path} → ${path.relative(process.cwd(), out)} (${n} frames)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
