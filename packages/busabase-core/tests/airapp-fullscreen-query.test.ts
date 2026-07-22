import { describe, expect, it } from "vitest";
import {
  isAirAppFullscreenSearch,
  updateAirAppFullscreenSearch,
} from "../src/domains/airapp/utils/fullscreen-query";

describe("AirApp fullscreen query state", () => {
  it("treats only fullscreen=1 as fullscreen", () => {
    expect(isAirAppFullscreenSearch("fullscreen=1")).toBe(true);
    expect(isAirAppFullscreenSearch("fullscreen=0")).toBe(false);
    expect(isAirAppFullscreenSearch("fullscreen=true")).toBe(false);
    expect(isAirAppFullscreenSearch("")).toBe(false);
  });

  it("adds the canonical fullscreen value while preserving other parameters", () => {
    expect(updateAirAppFullscreenSearch("chromeless=1&source=share", true)).toBe(
      "chromeless=1&source=share&fullscreen=1",
    );
    expect(updateAirAppFullscreenSearch("fullscreen=0&source=share", true)).toBe(
      "fullscreen=1&source=share",
    );
  });

  it("removes only fullscreen when exiting", () => {
    expect(updateAirAppFullscreenSearch("fullscreen=1&source=share", false)).toBe("source=share");
    expect(updateAirAppFullscreenSearch("fullscreen=1", false)).toBe("");
  });
});
