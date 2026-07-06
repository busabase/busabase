#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = process.argv.slice(2);
const distCli = resolve(root, "dist/cli.js");
const srcCli = resolve(root, "src/cli.ts");
const sdkDist = resolve(root, "../busabase-sdk/dist/index.js");

if (existsSync(distCli)) {
  await import(pathToFileURL(distCli).href);
} else if (existsSync(srcCli) && existsSync(sdkDist)) {
  try {
    import.meta.resolve("tsx");
  } catch {
    console.error(
      [
        "busabase-cli: dist/cli.js is missing and the source fallback needs `tsx`.",
        "Build the CLI first:",
        "  pnpm --filter busabase-cli build",
        "Or run the published package explicitly:",
        "  npm exec -y --package busabase-cli@latest -- busabase-cli",
      ].join("\n"),
    );
    process.exit(1);
  }

  const result = spawnSync(process.execPath, ["--import", "tsx", srcCli, ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`busabase-cli: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
  process.exit(result.status ?? 1);
} else if (existsSync(srcCli)) {
  console.error(
    [
      "busabase-cli: dist/cli.js is missing in this source checkout.",
      "Build the workspace packages first:",
      "  pnpm --filter busabase-sdk build",
      "  pnpm --filter busabase-cli build",
      "Or run the published package explicitly:",
      "  npm exec -y --package busabase-cli@latest -- busabase-cli",
    ].join("\n"),
  );
  process.exit(1);
} else {
  console.error(
    [
      "busabase-cli: no executable CLI entry was found.",
      "Expected either dist/cli.js in the published package or src/cli.ts in a source checkout.",
    ].join("\n"),
  );
  process.exit(1);
}
