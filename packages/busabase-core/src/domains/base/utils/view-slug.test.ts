import { describe, expect, it } from "vitest";
import { deriveViewSlug } from "./view-slug";

const NONE = new Set<string>();

describe("deriveViewSlug", () => {
  it("keeps the ASCII reading of a Latin name", () => {
    expect(deriveViewSlug("Open tasks", NONE)).toBe("open-tasks");
    expect(deriveViewSlug("看板 · Board", NONE)).toBe("board");
  });

  it("falls back to view-<hash> when the name has no ASCII letters or digits", () => {
    const slug = deriveViewSlug("看板 · 按状态", NONE);
    expect(slug).toMatch(/^view-[a-z0-9]+$/);
    // Deterministic, and different names give different slugs.
    expect(deriveViewSlug("看板 · 按状态", NONE)).toBe(slug);
    expect(deriveViewSlug("日历 · 会议", NONE)).not.toBe(slug);
    expect(deriveViewSlug("   ", NONE)).toMatch(/^view-[a-z0-9]+$/);
  });

  it("never returns a slug that is already taken", () => {
    const taken = new Set(["board", "board-2"]);
    expect(deriveViewSlug("Board", taken)).toBe("board-3");
    const cjk = deriveViewSlug("看板", NONE);
    expect(deriveViewSlug("看板", new Set([cjk]))).toBe(`${cjk}-2`);
  });
});
