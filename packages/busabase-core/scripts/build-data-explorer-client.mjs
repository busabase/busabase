/**
 * Re-bundle the "Workspace Data Explorer" demo's browser entry and write it
 * back into `demo-content-data-explorer.ts` as the `DATA_EXPLORER_CLIENT_JS`
 * literal.
 *
 * The bundle is produced here, at authoring time, and baked in as a static
 * `client.js` — esbuild ships a platform-native binary, which Nodepod cannot
 * load, so the demo itself must never run a build step.
 *
 * Usage: pnpm --filter busabase-sdk build && node packages/busabase-core/scripts/build-data-explorer-client.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const entry = path.join(here, "../src/domains/airapp/demo-assets/data-explorer-client.js");
const target = path.join(here, "../src/domains/airapp/demo-content-data-explorer.ts");
const sdkDist = path.join(repoRoot, "apps/busabase-sdk/dist/index.js");

const out = path.join(mkdtempSync(path.join(tmpdir(), "data-explorer-")), "client.js");
execFileSync(
  path.join(repoRoot, "node_modules/.bin/esbuild"),
  [
    entry,
    "--bundle",
    "--format=esm",
    "--platform=browser",
    "--minify",
    `--alias:busabase-sdk=${sdkDist}`,
    `--outfile=${out}`,
  ],
  { stdio: "inherit" },
);

const bundle = readFileSync(out, "utf8").trimEnd();
const source = readFileSync(target, "utf8");
const marker = "const DATA_EXPLORER_CLIENT_JS =\n  ";
const start = source.indexOf(marker);
if (start === -1) throw new Error("DATA_EXPLORER_CLIENT_JS literal not found");
const valueStart = start + marker.length;
const end = source.indexOf(";\n", valueStart);
writeFileSync(
  target,
  source.slice(0, valueStart) + JSON.stringify(bundle) + source.slice(end),
  "utf8",
);
console.log(`Bundled ${(bundle.length / 1024).toFixed(0)}KB into demo-content-data-explorer.ts`);
