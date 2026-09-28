import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const fixtureRoots: string[] = [];
const script = resolve(import.meta.dirname, "../scripts/pack-standalone.mjs");

async function put(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("pack-standalone", () => {
  it("promotes a nested traced external and rewrites its hashed specifier", async () => {
    const root = await mkdtemp(join(tmpdir(), "busabase-pack-"));
    fixtureRoots.push(root);
    const app = join(root, "apps/busabase");
    const standalone = join(app, ".next/standalone");
    const standaloneApp = join(standalone, "apps/busabase");
    const nestedModules = join(standalone, "packages/kui/node_modules");

    await mkdir(join(app, "scripts"), { recursive: true });
    await copyFile(script, join(app, "scripts/pack-standalone.mjs"));
    await put(join(standaloneApp, "server.js"), "// fixture\n");
    await put(join(standaloneApp, ".env"), "SECRET=do-not-publish\n");
    await put(join(standaloneApp, ".env.example"), "SECRET=\n");
    await put(
      join(standaloneApp, ".next/server/chunks/ssr/page.js"),
      'externalImport("shiki-6e88fe9ebf9cdd7c/core");\n',
    );
    await put(
      join(nestedModules, "shiki/package.json"),
      JSON.stringify({ name: "shiki", type: "module", dependencies: { "@shikijs/core": "1.0.0" } }),
    );
    await put(join(nestedModules, "shiki/index.mjs"), 'export * from "@shikijs/core";\n');
    await put(
      join(nestedModules, "@shikijs/core/package.json"),
      JSON.stringify({ name: "@shikijs/core", version: "1.0.0" }),
    );
    await put(join(nestedModules, "@shikijs/core/index.js"), "module.exports = {};\n");

    const { stdout } = await execFileAsync(process.execPath, [
      join(app, "scripts/pack-standalone.mjs"),
    ]);

    expect(stdout).toContain("rewrite shiki-6e88fe9ebf9cdd7c -> shiki");
    await expect(access(join(standaloneApp, ".env"))).rejects.toThrow();
    await expect(readFile(join(standaloneApp, ".env.example"), "utf8")).resolves.toBe("SECRET=\n");
    expect(await readFile(join(standaloneApp, ".next/server/chunks/ssr/page.js"), "utf8")).toBe(
      'externalImport("shiki/core");\n',
    );
    expect(
      JSON.parse(await readFile(join(standalone, "node_modules/shiki/package.json"), "utf8")),
    ).toMatchObject({
      name: "shiki",
    });
    expect(
      JSON.parse(
        await readFile(join(standalone, "node_modules/@shikijs/core/package.json"), "utf8"),
      ),
    ).toMatchObject({ name: "@shikijs/core" });
  });
});
