import { describe, expect, it } from "vitest";
import { assertAirAppRunnable } from "./airapp-runnable";

const pkg = (scripts: Record<string, string>, rest: Record<string, unknown> = {}) => ({
  path: "package.json",
  content: JSON.stringify({ name: "app", private: true, type: "module", scripts, ...rest }),
});

describe("assertAirAppRunnable", () => {
  // The exact payload that produced the original bug report: an agent with no guidance
  // scaffolds a Vite app, whose package.json has `start` and no `dev`. Both engines run
  // `npm run dev`, so it died on `Missing script: "dev"` after installing 50 packages.
  it("rejects the Vite scaffold that started all this", () => {
    expect(() => assertAirAppRunnable("airapp", [pkg({ start: "vite --host 0.0.0.0" })])).toThrow(
      /no `dev` script/,
    );
  });

  it("rejects a bundler dev server even when the script IS called dev", () => {
    // Renaming the script is not a fix: Vite cannot boot under Nodepod at all. Accepting this
    // would just move the failure one step later, which is worse — it looks fixed.
    expect(() => assertAirAppRunnable("airapp", [pkg({ dev: "vite --host 0.0.0.0" })])).toThrow(
      /cannot boot in the AirApp runtime/,
    );
    for (const command of [
      "webpack serve",
      "next dev",
      "parcel index.html",
      "react-scripts start",
    ]) {
      expect(() => assertAirAppRunnable("airapp", [pkg({ dev: command })])).toThrow(/cannot boot/);
    }
  });

  it("allows the one bundler pin verified to actually boot", () => {
    // vite@7.3.1 is not a theoretical exception — it's the exact pin
    // Nodepod's own examples/issue-44-react-dev-server "known good" button
    // real-boots against the current published @scelar/nodepod: onServerReady
    // fires and the dev server answers 200 through the SW proxy. Verified in
    // both devDependencies and dependencies since a caller could reasonably
    // put it in either.
    expect(() =>
      assertAirAppRunnable("airapp", [
        pkg({ dev: "vite" }, { devDependencies: { vite: "7.3.1" } }),
      ]),
    ).not.toThrow();
    expect(() =>
      assertAirAppRunnable("airapp", [pkg({ dev: "vite" }, { dependencies: { vite: "7.3.1" } })]),
    ).not.toThrow();
  });

  it("still rejects every other vite pin, including plausible-looking ones", () => {
    // Adjacent versions are not close enough: 5.x/6.x throw on esbuild's WASM
    // init, and 8.x's default rolldown bundler ships a native binding this
    // runtime can't resolve — both reproduced live, not assumed. A caret
    // range that *could* resolve to 7.3.1 is still rejected: the exemption is
    // for the exact pin that was actually verified, not for "probably fine."
    for (const version of ["8.0.10", "5.4.11", "^7.3.1", "7.3.0", ""]) {
      expect(() =>
        assertAirAppRunnable("airapp", [
          pkg({ dev: "vite" }, { devDependencies: { vite: version } }),
        ]),
      ).toThrow(/cannot boot in the AirApp runtime/);
    }
  });

  it("still rejects other bundlers even though vite has a verified pin", () => {
    // The allowlist is per-bundler-name; vite's exemption must not leak into
    // webpack/next/etc, which have no verified-runnable pin at all.
    expect(() =>
      assertAirAppRunnable("airapp", [
        pkg({ dev: "webpack serve" }, { devDependencies: { webpack: "7.3.1" } }),
      ]),
    ).toThrow(/cannot boot in the AirApp runtime/);
  });

  it("sees through a path-qualified or npx-wrapped bundler", () => {
    for (const command of [
      "./node_modules/.bin/vite",
      "npx vite --port 3000",
      "node_modules/.bin/next dev",
    ]) {
      expect(() => assertAirAppRunnable("airapp", [pkg({ dev: command })])).toThrow(/cannot boot/);
    }
  });

  it("accepts the shape the guide and the scaffold both teach", () => {
    expect(() =>
      assertAirAppRunnable("airapp", [pkg({ dev: "node server.js", start: "node server.js" })]),
    ).not.toThrow();
  });

  it("does not mistake a build-time dependency for a dev server", () => {
    // Depending on vite while `dev` still starts plain Node is legitimate — the check reads the
    // command line, not the dependency list, precisely so this keeps working.
    expect(() =>
      assertAirAppRunnable("airapp", [
        pkg({ dev: "node server.js" }, { devDependencies: { vite: "^5.0.0" } }),
      ]),
    ).not.toThrow();
  });

  it("stays silent when this request is not writing package.json", () => {
    // The two rules that make this safe on both write paths:
    //  - create with mergeMode "merge": no package.json here means the scaffold's good one applies
    //  - change request: an edit to one file says nothing about another
    expect(() =>
      assertAirAppRunnable("airapp", [{ path: "client.js", content: "console.log(1)" }]),
    ).not.toThrow();
    expect(() => assertAirAppRunnable("airapp", [])).not.toThrow();
    // A path with no inline content (an assetId-backed file) is not parseable and not our business.
    expect(() => assertAirAppRunnable("airapp", [{ path: "package.json" }])).not.toThrow();
  });

  it("rejects deleting the file the runner needs", () => {
    expect(() =>
      assertAirAppRunnable("airapp", [{ path: "package.json" }], {
        deletedPaths: ["package.json"],
      }),
    ).toThrow(/deletes `package.json`/);
  });

  it("leaves Skills and Drives alone", () => {
    // They are documents, not programs. A SKILL.md repo has no dev script and never needed one.
    for (const type of ["skill", "drive"]) {
      expect(() => assertAirAppRunnable(type, [pkg({ start: "vite" })])).not.toThrow();
    }
  });

  it("reports malformed JSON as such instead of as a missing script", () => {
    expect(() =>
      assertAirAppRunnable("airapp", [{ path: "package.json", content: "{ not json" }]),
    ).toThrow(/not valid JSON/);
  });

  it("explains the replace-at-path trap in the rejection itself", () => {
    // The agent needs to know WHY its package.json did not inherit the scaffold's dev script,
    // or it will retry with the same payload.
    expect(() => assertAirAppRunnable("airapp", [pkg({ start: "vite" })])).toThrow(
      /REPLACES the default scaffold/,
    );
  });

  it("throws a structured 422, not a bare Error", () => {
    // A plain Error becomes a 500 through the oRPC handler; the caller needs a client error.
    try {
      assertAirAppRunnable("airapp", [pkg({ start: "vite" })]);
      throw new Error("expected a rejection");
    } catch (error) {
      expect((error as { status?: number }).status).toBe(422);
      expect((error as { code?: string }).code).toBe("AIRAPP_NOT_RUNNABLE");
    }
  });
});
