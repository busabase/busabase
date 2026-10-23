/**
 * `busabase-cli check` reaches every AirApp in a package with the SDK's rules —
 * proven on a real directory read from disk, not on a hand-built sources object,
 * because the collector between the two is where rules have gone missing before.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkDirectory } from "./check";

const PROVIDER_BEFORE_FIX = `import { isStandaloneLocalRuntime } from "../runtime.js";
export async function save(client, recordId, fields) {
  const autoMerge = isStandaloneLocalRuntime();
  return client.records.changeRequest({ recordId, operation: "update", fields, autoMerge });
}
`;

const PROVIDER_AFTER_FIX = `export async function save(client, recordId, fields) {
  // autoMerge is left unset: the person's own permission decides.
  return client.records.changeRequest({ recordId, operation: "update", fields });
}
`;

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const writePackage = async (provider: string) => {
  const root = await mkdtemp(join(tmpdir(), "busabase-check-"));
  dirs.push(root);
  const files: Record<string, string> = {
    "busabase.json": JSON.stringify({ format: "busabase-package@1", name: "fixture" }),
    "content/_folder.json": JSON.stringify({ name: "Fixture" }),
    "content/fixture-app/_node.json": JSON.stringify({ type: "airapp", name: "Fixture App" }),
    "content/fixture-app/package.json": JSON.stringify({
      name: "fixture-app",
      type: "module",
      scripts: { dev: "node server.js", start: "node server.js" },
      dependencies: { "busabase-sdk": "0.98.0" },
    }),
    "content/fixture-app/server.js": "console.log('serve');\n",
    "content/fixture-app/app/js/providers/busabase-provider.js": provider,
    // A vendored bundle may say anything; it is not the app's code.
    "content/fixture-app/app/vendor/busabase-airapp.js": "publish({ autoMerge: false });\n",
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
};

const forcedReview = async (root: string) => {
  const result = await checkDirectory(root, { only: "airapp" });
  const layer = result.layers.find((entry) => entry.layer === "airapp");
  expect(layer?.applicable).toBe(true);
  return (layer?.findings ?? []).filter((finding) => finding.rule === "airapp/forced-review");
};

describe("busabase-cli check: airapp/forced-review", () => {
  it("fails an app that works autoMerge out from where it runs", async () => {
    const findings = await forcedReview(await writePackage(PROVIDER_BEFORE_FIX));
    expect(findings.map((finding) => finding.message.split(": ")[0])).toEqual([
      "app/js/providers/busabase-provider.js:3",
      "app/js/providers/busabase-provider.js:4",
    ]);
    expect(findings.every((finding) => finding.severity === "error")).toBe(true);
  });

  it("passes the same app once autoMerge is left unset", async () => {
    expect(await forcedReview(await writePackage(PROVIDER_AFTER_FIX))).toEqual([]);
  });
});
