import { describe, expect, it } from "vitest";
import { getAirAppFallbackGlyph } from "./app-icon";

describe("getAirAppFallbackGlyph", () => {
  it.each([
    ["Customer Portal", { isEmoji: false, value: "CP" }],
    ["analytics", { isEmoji: false, value: "AN" }],
    ["客户管理", { isEmoji: false, value: "客户" }],
    ["客户 CRM", { isEmoji: false, value: "客C" }],
    ["  ", { isEmoji: false, value: "A" }],
  ])("derives a stable glyph for %j", (name, expected) => {
    expect(getAirAppFallbackGlyph(name)).toEqual(expected);
    expect(getAirAppFallbackGlyph(name)).toEqual(expected);
  });

  it("keeps a leading emoji as one grapheme", () => {
    expect(getAirAppFallbackGlyph("👩‍💻 Developer Console")).toEqual({
      isEmoji: true,
      value: "👩‍💻",
    });
  });

  it("only returns the first two graphemes for a long unbroken name", () => {
    expect(getAirAppFallbackGlyph("Supercalifragilisticexpialidocious").value).toBe("SU");
  });
});
