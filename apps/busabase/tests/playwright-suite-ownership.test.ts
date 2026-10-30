import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(__dirname, "..");
const specNames = (source: string) => source.match(/[a-z0-9-]+\.spec\.ts/g) ?? [];

/**
 * A spec with its own Playwright config needs something the default run does not
 * supply: real credentials or a fixture server. Left in the default run it fails
 * slowly, and at six minutes a try with two retries it uses up the job's time limit
 * before the rest of the suite has run.
 */
describe("the default e2e run", () => {
  it("ignores every spec that a dedicated config owns", () => {
    const defaultConfig = readFileSync(path.join(appRoot, "playwright.config.ts"), "utf8");
    const ignoreList = defaultConfig.match(/testIgnore:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
    const ignored = new Set(specNames(ignoreList));

    const owned = readdirSync(appRoot)
      .filter((file) => /^playwright\..+\.config\.ts$/.test(file))
      .flatMap((file) => {
        const source = readFileSync(path.join(appRoot, file), "utf8");
        const testMatch = source.match(/testMatch:\s*(\[[\s\S]*?\]|"[^"]+")/)?.[1] ?? "";
        return specNames(testMatch);
      });

    expect(owned.length).toBeGreaterThan(0);
    expect(owned.filter((spec) => !ignored.has(spec))).toEqual([]);
  });
});
