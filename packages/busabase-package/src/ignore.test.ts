import { describe, expect, it } from "vitest";
import { IGNORE_NOTHING, parseIgnoreFile } from "./ignore";

describe("parseIgnoreFile", () => {
  it("ignores nothing for an empty or comment-only file", () => {
    const matcher = parseIgnoreFile("# just a note\n\n   \n");
    expect(matcher.isEmpty).toBe(true);
    expect(matcher.ignores("package.json")).toBe(false);
  });

  it("excludes a directory and everything under it", () => {
    const matcher = parseIgnoreFile("test/\n");
    expect(matcher.ignores("test")).toBe(true);
    expect(matcher.ignores("test/unit/email.test.mjs")).toBe(true);
    expect(matcher.ignores("server/test-helpers.js")).toBe(false);
  });

  it("matches a bare name at any depth, file or directory", () => {
    const matcher = parseIgnoreFile("coverage\n");
    expect(matcher.ignores("coverage")).toBe(true);
    expect(matcher.ignores("app/coverage/lcov.info")).toBe(true);
    expect(matcher.ignores("app/coverage-report.md")).toBe(false);
  });

  it("anchors a leading-slash pattern to the root", () => {
    const matcher = parseIgnoreFile("/build\n");
    expect(matcher.ignores("build/index.js")).toBe(true);
    expect(matcher.ignores("app/build/index.js")).toBe(false);
  });

  it("keeps * inside a single segment", () => {
    const matcher = parseIgnoreFile("*.log\n");
    expect(matcher.ignores("debug.log")).toBe(true);
    expect(matcher.ignores("logs/debug.log")).toBe(true);
    expect(matcher.ignores("debug.log.txt")).toBe(false);
  });

  it("lets ** cross segments, including zero of them", () => {
    const matcher = parseIgnoreFile("docs/**/*.tmp\n");
    expect(matcher.ignores("docs/a.tmp")).toBe(true);
    expect(matcher.ignores("docs/deep/deeper/a.tmp")).toBe(true);
    expect(matcher.ignores("other/a.tmp")).toBe(false);
  });

  it("applies the last matching rule, so ! re-includes", () => {
    const matcher = parseIgnoreFile("*.log\n!keep.log\n");
    expect(matcher.ignores("debug.log")).toBe(true);
    expect(matcher.ignores("keep.log")).toBe(false);
  });

  it("does not re-include when the negation comes first", () => {
    const matcher = parseIgnoreFile("!keep.log\n*.log\n");
    expect(matcher.ignores("keep.log")).toBe(true);
  });

  it("treats ? as a single non-slash character", () => {
    const matcher = parseIgnoreFile("cache?.bin\n");
    expect(matcher.ignores("cache1.bin")).toBe(true);
    expect(matcher.ignores("cache/1.bin")).toBe(false);
  });

  it("does not let a dir-only rule match a same-named file", () => {
    const matcher = parseIgnoreFile("dist/\n");
    expect(matcher.ignores("dist/app.js")).toBe(true);
    // `dist` as a plain file is not what `dist/` asked to exclude.
    expect(matcher.ignores("dist")).toBe(true); // it is the directory itself
    expect(matcher.ignores("nested/dist/app.js")).toBe(true);
  });

  it("treats regex metacharacters in a pattern as literals", () => {
    const matcher = parseIgnoreFile("report(final).pdf\n");
    expect(matcher.ignores("report(final).pdf")).toBe(true);
    expect(matcher.ignores("reportXfinalX.pdf")).toBe(false);
  });
});

describe("IGNORE_NOTHING", () => {
  it("installs everything", () => {
    expect(IGNORE_NOTHING.ignores("anything/at/all.txt")).toBe(false);
    expect(IGNORE_NOTHING.isEmpty).toBe(true);
  });
});
