import { describe, expect, it } from "vitest";
import { normalizeViewConfig } from "../src/logic/vo";

describe("normalizeViewConfig", () => {
  it("preserves Gallery cover field selection semantics", () => {
    expect(normalizeViewConfig({}).coverFieldSlug).toBeUndefined();
    expect(normalizeViewConfig({ coverFieldSlug: undefined }).coverFieldSlug).toBeUndefined();
    expect(normalizeViewConfig({ coverFieldSlug: null }).coverFieldSlug).toBeNull();
    expect(normalizeViewConfig({ coverFieldSlug: "cover-image" }).coverFieldSlug).toBe(
      "cover-image",
    );
  });
});
