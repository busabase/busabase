import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(__dirname, "..");
const { exports: exportsMap } = JSON.parse(
  readFileSync(path.join(packageRoot, "package.json"), "utf8"),
) as { exports: Record<string, string | Record<string, string>> };

const targetsOf = (value: string | Record<string, string>): string[] =>
  typeof value === "string" ? [value] : Object.values(value);

describe("busabase-core package exports", () => {
  it("points every subpath at a file that exists", () => {
    // A subpath whose file was moved or deleted is invisible here and in this
    // package's own typecheck; it breaks only the app that imports it (CI caught
    // busabase-mobile's `busabase-core/dashboard/markdown-preview` that way).
    const dangling = Object.entries(exportsMap).flatMap(([subpath, value]) =>
      targetsOf(value)
        .filter((target) => !target.includes("*") && !existsSync(path.join(packageRoot, target)))
        .map((target) => `${subpath} -> ${target}`),
    );
    expect(dangling).toEqual([]);
  });
});
