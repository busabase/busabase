import { micromark } from "micromark";
import { describe, expect, it } from "vitest";
import { markdownPreviewSource } from "./markdown-preview";

const SKILL =
  "---\nname: weekly-report\ndescription: Draft the weekly team report.\n---\n\n# Weekly report\n\nUse it.\n";
/** Top-level blocks as CommonMark's reference parser (a declared dependency) sees them. */
const blocks = (md: string) =>
  [...micromark(md).matchAll(/^<(hr|h[1-6]|p|pre)\b/gm)].map(([, tag]) =>
    tag === "hr"
      ? "thematicBreak"
      : tag === "p"
        ? "paragraph"
        : tag === "pre"
          ? "code"
          : `heading${tag.slice(1)}`,
  );

describe("markdownPreviewSource", () => {
  it("is what made frontmatter a heading — a plain parse reads it as one", () => {
    // Pins the bug itself, so the fix below is proven against the real parser.
    expect(blocks(SKILL)).toEqual(["thematicBreak", "heading2", "heading1", "paragraph"]);
  });

  it("turns frontmatter into a yaml code block, keeping every word of it", () => {
    const out = markdownPreviewSource(SKILL);
    expect(blocks(out)).toEqual(["code", "heading1", "paragraph"]);
    expect(out).toContain("name: weekly-report\ndescription: Draft the weekly team report.");
    expect(out.startsWith("```yaml\n")).toBe(true);
  });

  it("leaves markdown without frontmatter exactly as it was", () => {
    const md = "# Title\n\n---\n\nAfter a rule.\n";
    expect(markdownPreviewSource(md)).toBe(md);
  });

  it("does not mistake a later thematic break for frontmatter", () => {
    const md = "Intro\n\n---\nname: x\n---\n";
    expect(markdownPreviewSource(md)).toBe(md);
  });

  it("drops an empty frontmatter block rather than rendering an empty box", () => {
    expect(markdownPreviewSource("---\n---\n# Title\n")).toBe("# Title\n");
  });

  it("handles CRLF files and a byte-order mark", () => {
    const out = markdownPreviewSource("﻿---\r\nname: x\r\n---\r\n# T\r\n");
    expect(blocks(out)[0]).toBe("code");
  });

  it("keeps the block closed when the yaml itself contains a fence line", () => {
    // A block scalar carrying a code sample: its lone ``` line would close a
    // three-backtick fence early and spill the rest of the yaml out as prose.
    const md = "---\nexample: |\n  ```\n  pnpm test\n  ```\n---\n# T\n";
    expect(blocks(markdownPreviewSource(md))).toEqual(["code", "heading1"]);
  });
});
