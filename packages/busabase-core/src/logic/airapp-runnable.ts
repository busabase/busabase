/**
 * Write-time check that an AirApp can actually start.
 *
 * Busabase runs an AirApp by mounting its files, running `npm install`, then running
 * literally `npm run dev` — both engines, `domains/airapp/components/runners/nodepod-runner.ts`
 * (`spawn("npm", ["run", "dev"])`) and `domains/airapp/logic/local-node-runtime.ts`
 * (`runSandboxedCommand("npm run dev", …)`). There is no configuration under which something
 * else is started.
 *
 * An agent writing an AirApp from scratch reaches for the default modern scaffold, which
 * produces `"start": "vite --host 0.0.0.0"` and no `dev` script at all. That app installs 50
 * packages and then dies on `npm error Missing script: "dev"` before rendering a single pixel.
 * Documentation now warns about this in several places, but documentation only persuades — it
 * cannot stop a model that did not read it, and the failure is invisible until a human clicks
 * Run. This is the same rule, enforced.
 *
 * Deliberately narrow. Two conditions are rejected, and both are absolute rather than stylistic:
 *
 *   1. No `dev` script — the runner has nothing to invoke.
 *   2. A `dev` script that starts a bundler dev server that cannot boot in this runtime. Most
 *      bundler versions genuinely cannot: unpinned/old Vite (5.x/6.x) throws
 *      `Cannot destructure property 'createServer' of '(intermediate value)'` out of its
 *      esbuild WASM init, and Vite 8's default rolldown bundler ships a native `.node`-class
 *      WASM binding Nodepod's browser-emulated npm cannot resolve
 *      (`Cannot find native binding`) — reproduced live against Nodepod 1.9.20 via its own
 *      `examples/vite-dev-exit-1` and `examples/issue-44-react-dev-server` regression pages,
 *      both with and without cross-origin isolation. So renaming a Vite scaffold's script to
 *      `dev` is NOT a fix for those versions, and accepting them would only move the failure
 *      one step later. `vite@7.3.1` is the one pin that is NOT theoretical: the same
 *      `issue-44-react-dev-server` page's "known good" button, run against the current
 *      published `@scelar/nodepod`, real-boots it — `onServerReady` fires and the dev server
 *      answers 200 through the SW proxy — so that exact pin (see
 *      `KNOWN_RUNNABLE_BUNDLER_VERSIONS` below) is let through instead of blocked on faith.
 *
 * Native-binary dependencies (esbuild, `@swc/core`, sharp, sqlite3) also cannot load in this
 * runtime, but they are NOT rejected here: any package may ship a binary transitively, so a
 * denylist would both miss real cases and block innocent ones. That belongs in a warnings
 * channel this write path does not have. Documented gap, not an oversight.
 */

import { ORPCError } from "@orpc/server";

/** Same minimal shape `upload-safety.ts` checks, so both call sites pass what they already have. */
export interface AirAppFileEntry {
  path: string;
  content?: string;
}

const PACKAGE_JSON = "package.json";

/**
 * Bundler dev servers. Matched against the `dev` script's command line, not the dependency
 * list — a project may legitimately depend on one of these for an offline build step while
 * `dev` still starts a plain Node server.
 */
const BUNDLER_COMMANDS = [
  "vite",
  "webpack",
  "next",
  "parcel",
  "rollup",
  "react-scripts",
  "nuxt",
  "astro",
  "remix",
] as const;

/**
 * Exact bundler `devDependencies`/`dependencies` pins verified to actually boot a reachable dev
 * server inside Nodepod — real `onServerReady` + a real 200 through the SW proxy, not just a
 * clean process exit (an earlier check here on the process exit code alone was a false
 * positive: the process can exit 0 after an *unhandled rejection* crashed the dev server before
 * it ever bound a port). Only `vite@7.3.1` is verified today. Extend this only after reproducing
 * the same real-boot evidence for the new pin — a version number added on faith defeats the
 * point of this allowlist.
 */
const KNOWN_RUNNABLE_BUNDLER_VERSIONS: Readonly<Record<string, readonly string[]>> = {
  vite: ["7.3.1"],
};

/** Normalises `./node_modules/.bin/vite`, `npx vite`, `vite build && vite` to bare tokens. */
const commandTokens = (script: string): string[] =>
  script
    .split(/[\s;&|]+/)
    .map((token) => token.replace(/^.*[/\\]/, "").trim())
    .filter(Boolean);

const detectBundler = (devScript: string): string | undefined =>
  commandTokens(devScript).find((token) => (BUNDLER_COMMANDS as readonly string[]).includes(token));

const reject = (reason: string, fix: string): never => {
  throw new ORPCError("AIRAPP_NOT_RUNNABLE", {
    status: 422,
    // The message is what an agent sees and acts on, so it states the rule, the reason, and the
    // concrete correction — not just "invalid".
    message: `AirApp rejected: ${reason} Busabase starts an AirApp with \`npm install\` then \`npm run dev\`, so this app could not start. ${fix}`,
    data: { reason, fix },
  });
};

/**
 * Validate the `package.json` **being written by this request**, if there is one.
 *
 * Crucially this does NOT validate the node's resulting full file set, and must not try to:
 *
 * - On create, `mergeMode: "merge"` (the default) layers the caller's files over the built-in
 *   scaffold, which already ships a correct `package.json`. A caller that sends no
 *   `package.json` is relying on that good default — rejecting them would be a false positive.
 * - On a change request, only a delta arrives. An edit to `client.js` says nothing about
 *   `package.json` and must not be blocked by it.
 *
 * So the rule is the same on both paths and is the honest one: **you cannot break what you are
 * not touching.** Check the `package.json` in this payload; if there isn't one, there is
 * nothing this request could have broken.
 *
 * A `delete` of `package.json` arrives with no `content` and is caught separately — it removes
 * the file the runner needs, which no later write in the same request can undo.
 */
export const assertAirAppRunnable = (
  nodeType: string,
  entries: readonly AirAppFileEntry[],
  options: { readonly deletedPaths?: readonly string[] } = {},
): void => {
  // Skills and Drives are documents, not programs — nothing here applies to them.
  if (nodeType !== "airapp") return;

  if (options.deletedPaths?.some((path) => path === PACKAGE_JSON)) {
    reject(
      "it deletes `package.json`.",
      "Keep a `package.json` with a `dev` script that starts a plain Node server.",
    );
  }

  const entry = entries.find((candidate) => candidate.path === PACKAGE_JSON);
  if (!entry || typeof entry.content !== "string") return;

  let parsed: {
    scripts?: Record<string, unknown>;
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  try {
    parsed = JSON.parse(entry.content) as typeof parsed;
  } catch {
    reject("its `package.json` is not valid JSON.", "Fix the JSON syntax, then retry.");
    return;
  }

  const dev = parsed.scripts?.dev;
  if (typeof dev !== "string" || dev.trim() === "") {
    reject(
      "its `package.json` has no `dev` script.",
      'Add `"dev": "node server.js"` to `scripts`. A supplied `package.json` REPLACES the default scaffold\'s, so its `dev` script is not inherited.',
    );
    return;
  }

  const bundler = detectBundler(dev);
  if (bundler) {
    const runnablePins = KNOWN_RUNNABLE_BUNDLER_VERSIONS[bundler];
    const pinnedVersion = parsed.devDependencies?.[bundler] ?? parsed.dependencies?.[bundler];
    if (runnablePins && typeof pinnedVersion === "string" && runnablePins.includes(pinnedVersion)) {
      return;
    }
    reject(
      `its \`dev\` script starts \`${bundler}\`, a bundler dev server that cannot boot in the AirApp runtime` +
        (runnablePins
          ? ` unless pinned to exactly ${runnablePins.map((v) => `${bundler}@${v}`).join(" or ")} (found ${
              typeof pinnedVersion === "string"
                ? `${bundler}@${pinnedVersion}`
                : "no pinned version"
            }).`
          : "."),
      runnablePins
        ? `Pin \`"${bundler}": "${runnablePins[0]}"\` in devDependencies, or serve the app from a plain Node server instead — \`"dev": "node server.js"\` with Hono or \`node:http\`.`
        : 'Serve the app from a plain Node server instead — `"dev": "node server.js"` with Hono or `node:http`, and browser files that need no build step.',
    );
  }
};
