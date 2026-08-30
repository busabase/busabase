/**
 * `assertSafeFilePath` guards file-tree paths against shapes that break a git
 * checkout on Windows/macOS. Regression coverage for the bug where it also
 * rejected a LEADING dot — the ordinary hidden-file convention (`.gitignore`,
 * `.env`, `.eslintrc`) that every real AirApp source tree uses, and which
 * checks out identically on every OS. Found live: `busabase-cli export`
 * refused every AirApp that happened to carry a `.gitignore`.
 */
import { describe, expect, it } from "vitest";
import { assertSafeFilePath } from "./tree";

describe("assertSafeFilePath", () => {
  it("accepts a leading-dot filename (the hidden-file convention)", () => {
    expect(() => assertSafeFilePath(".gitignore", "airapp")).not.toThrow();
    expect(() => assertSafeFilePath("app/.env.example", "airapp")).not.toThrow();
    expect(() => assertSafeFilePath(".github/workflows/ci.yml", "airapp")).not.toThrow();
  });

  it("still rejects a TRAILING dot or space — silently stripped by Windows on checkout", () => {
    expect(() => assertSafeFilePath("notes.", "airapp")).toThrow(/ends with a dot or space/);
    expect(() => assertSafeFilePath("notes ", "airapp")).toThrow(/ends with a dot or space/);
    expect(() => assertSafeFilePath("app/config. ", "airapp")).toThrow(/ends with a dot or space/);
  });

  it("still rejects Windows/macOS-illegal characters", () => {
    expect(() => assertSafeFilePath("app/con:fig.js", "airapp")).toThrow(/illegal in a file name/);
  });

  it("still rejects an empty path segment", () => {
    expect(() => assertSafeFilePath("app//config.js", "airapp")).toThrow(/empty path segment/);
  });
});
