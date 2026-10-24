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

/**
 * A throwaway workspace laid out like the one that broke 0.98.0: two majors of an
 * external's dependency, the older one beside the app that pins it, the newer one
 * hoisted to the workspace root, and a standalone tree where Next copied the
 * external itself but only stubbed what it depends on.
 */
async function workspaceWithTwoVersions() {
  const root = await mkdtemp(join(tmpdir(), "busabase-pack-"));
  fixtureRoots.push(root);
  const app = join(root, "apps/busabase");
  const standalone = join(app, ".next/standalone");
  const standaloneApp = join(standalone, "apps/busabase");
  const manifest = (name: string, version: string, extra: object = {}) =>
    JSON.stringify({ name, version, type: "module", ...extra });

  await mkdir(join(app, "scripts"), { recursive: true });
  await copyFile(script, join(app, "scripts/pack-standalone.mjs"));
  await put(join(standaloneApp, "server.js"), "// fixture\n");
  await put(
    join(standaloneApp, ".next/server/chunks/ssr/page.js"),
    'externalImport("shiki-6e88fe9ebf9cdd7c");\n',
  );

  // Workspace: root has shiki/core 2.0.0; packages/kui pins shiki 1.0.0 and, beside
  // it, core 1.0.0 with real code.
  await put(join(root, "node_modules/shiki/package.json"), manifest("shiki", "2.0.0"));
  await put(
    join(root, "node_modules/@shikijs/core/package.json"),
    manifest("@shikijs/core", "2.0.0"),
  );
  await put(join(root, "node_modules/@shikijs/core/dist/index.mjs"), "export const major = 2;\n");
  const kui = join(root, "packages/kui/node_modules");
  await put(
    join(kui, "shiki/package.json"),
    manifest("shiki", "1.0.0", {
      dependencies: { "@shikijs/core": "1.0.0", "browser-only": "1.0.0" },
    }),
  );
  await put(join(kui, "shiki/dist/index.mjs"), 'export * from "@shikijs/core";\n');
  await put(
    join(kui, "@shikijs/core/package.json"),
    manifest("@shikijs/core", "1.0.0", { dependencies: { "@shikijs/types": "1.0.0" } }),
  );
  await put(join(kui, "@shikijs/types/package.json"), manifest("@shikijs/types", "1.0.0"));
  await put(join(kui, "@shikijs/types/dist/index.mjs"), "export const types = 1;\n");
  await put(join(kui, "browser-only/package.json"), manifest("browser-only", "1.0.0"));
  await put(join(kui, "browser-only/index.mjs"), "export const browser = 1;\n");
  await put(join(kui, "@shikijs/core/dist/index.mjs"), "export const major = 1;\n");
  await put(join(kui, "@shikijs/core/dist/extra.mjs"), "export const extra = 1;\n");

  // Standalone, as Next left it: shiki 1.0.0 at the root with one traced file, and a
  // root @shikijs/core that is the 2.0.0 manifest alone, no code.
  const traced = join(standalone, "node_modules");
  await put(
    join(traced, "shiki/package.json"),
    manifest("shiki", "1.0.0", { dependencies: { "@shikijs/core": "1.0.0" } }),
  );
  await put(join(traced, "shiki/dist/index.mjs"), 'export * from "@shikijs/core";\n');
  await put(join(traced, "@shikijs/core/package.json"), manifest("@shikijs/core", "2.0.0"));
  await put(
    join(standalone, "packages/kui/node_modules/shiki/package.json"),
    manifest("shiki", "1.0.0"),
  );

  return { app, standalone, traced };
}

const run = (app: string) =>
  execFileAsync(process.execPath, [join(app, "scripts/pack-standalone.mjs")]);

describe("pack-standalone", () => {
  it("gives an external its own copy of a dependency when the root holds another version", async () => {
    const { app, traced } = await workspaceWithTwoVersions();

    const { stdout } = await run(app);

    // The 1.0.0 core the 1.0.0 shiki was installed with, complete, below shiki...
    const nested = join(traced, "shiki/node_modules/@shikijs/core");
    expect(JSON.parse(await readFile(join(nested, "package.json"), "utf8")).version).toBe("1.0.0");
    expect(await readFile(join(nested, "dist/index.mjs"), "utf8")).toBe(
      "export const major = 1;\n",
    );
    expect(await readFile(join(nested, "dist/extra.mjs"), "utf8")).toBe(
      "export const extra = 1;\n",
    );
    expect(stdout).toContain("repair node_modules/shiki/node_modules/@shikijs/core");
    // That core was never traced, so what IT depends on is copied too, beside it...
    expect(await readFile(join(nested, "node_modules/@shikijs/types/dist/index.mjs"), "utf8")).toBe(
      "export const types = 1;\n",
    );
    // ...whereas a dependency Next left out of the shiki it DID trace stays out.
    await expect(access(join(traced, "browser-only"))).rejects.toThrow();
    await expect(access(join(traced, "shiki/node_modules/browser-only"))).rejects.toThrow();
    // ...and the root's other version is left exactly as it was: other packages may need it.
    expect(
      JSON.parse(await readFile(join(traced, "@shikijs/core/package.json"), "utf8")).version,
    ).toBe("2.0.0");
    await expect(access(join(traced, "@shikijs/core/dist/index.mjs"))).rejects.toThrow();
  });

  it("keeps a traced copy of a compatible version instead of nesting another", async () => {
    const { app, traced } = await workspaceWithTwoVersions();
    // 1.2.0 with code is what Next traced; shiki was installed against 1.0.0.
    await put(
      join(traced, "@shikijs/core/package.json"),
      JSON.stringify({ name: "@shikijs/core", version: "1.2.0", type: "module" }),
    );
    await put(join(traced, "@shikijs/core/dist/index.mjs"), "export const major = 1.2;\n");

    await run(app);

    expect(await readFile(join(traced, "@shikijs/core/dist/index.mjs"), "utf8")).toBe(
      "export const major = 1.2;\n",
    );
    await expect(access(join(traced, "shiki/node_modules"))).rejects.toThrow();
  });

  it("does not copy type-only dependencies", async () => {
    const { app, traced } = await workspaceWithTwoVersions();
    const kui = join(app, "../../packages/kui/node_modules");
    await put(
      join(kui, "@shikijs/core/package.json"),
      JSON.stringify({
        name: "@shikijs/core",
        version: "1.0.0",
        type: "module",
        dependencies: { "@types/hast": "1.0.0" },
      }),
    );
    await put(
      join(kui, "@types/hast/package.json"),
      JSON.stringify({ name: "@types/hast", version: "1.0.0" }),
    );
    await put(join(kui, "@types/hast/index.d.ts"), "export {};\n");

    await run(app);

    await expect(
      access(join(traced, "shiki/node_modules/@shikijs/core/node_modules/@types")),
    ).rejects.toThrow();
  });

  it("fills a same-version stub in place instead of nesting a second copy", async () => {
    const { app, traced } = await workspaceWithTwoVersions();
    // The root copy is the right version this time, but still only a manifest.
    await put(
      join(traced, "@shikijs/core/package.json"),
      JSON.stringify({ name: "@shikijs/core", version: "1.0.0", type: "module" }),
    );

    await run(app);

    expect(await readFile(join(traced, "@shikijs/core/dist/index.mjs"), "utf8")).toBe(
      "export const major = 1;\n",
    );
    await expect(access(join(traced, "shiki/node_modules"))).rejects.toThrow();
  });

  it("leaves a dependency that is already traced, at the right version, alone", async () => {
    const { app, traced } = await workspaceWithTwoVersions();
    await put(
      join(traced, "@shikijs/core/package.json"),
      JSON.stringify({ name: "@shikijs/core", version: "1.0.0", type: "module" }),
    );
    // Next traced one file of it; the workspace copy has more. Tracing is trusted.
    await put(join(traced, "@shikijs/core/dist/index.mjs"), "export const traced = true;\n");

    const { stdout } = await run(app);

    expect(await readFile(join(traced, "@shikijs/core/dist/index.mjs"), "utf8")).toBe(
      "export const traced = true;\n",
    );
    await expect(access(join(traced, "@shikijs/core/dist/extra.mjs"))).rejects.toThrow();
    expect(stdout).not.toContain("repair node_modules/@shikijs/core");
  });

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
