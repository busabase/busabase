import { describe, expect, it } from "vitest";
import { toSlugInput } from "./slug-input";

describe("toSlugInput", () => {
  it("lowercases and turns anything outside [a-z0-9-] into a single hyphen", () => {
    expect(toSlugInput("Weekly Report")).toBe("weekly-report");
    expect(toSlugInput("AI 管理 CAIO")).toBe("ai-caio");
    expect(toSlugInput("a--b__c")).toBe("a-b-c");
  });

  it("drops leading hyphens but keeps a trailing one while typing", () => {
    expect(toSlugInput("--draft")).toBe("draft");
    expect(toSlugInput("my-")).toBe("my-");
  });
});
