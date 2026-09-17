import { describe, expect, it } from "vitest";
import {
  isAirAppFullscreenSearch,
  updateAirAppFullscreenSearch,
} from "../../airapp/utils/fullscreen-query";
import { isPreviewFullscreenSearch, updatePreviewFullscreenSearch } from "./fullscreen-query";

describe("preview fullscreen query", () => {
  it("recognizes only fullscreen=1", () => {
    expect(isPreviewFullscreenSearch("fullscreen=1")).toBe(true);
    expect(isPreviewFullscreenSearch("fullscreen=0")).toBe(false);
    expect(isPreviewFullscreenSearch("view=preview")).toBe(false);
  });

  it("preserves unrelated query parameters when entering and exiting", () => {
    const entered = updatePreviewFullscreenSearch("demo=node-types&lang=en", true);
    expect(new URLSearchParams(entered).get("demo")).toBe("node-types");
    expect(new URLSearchParams(entered).get("lang")).toBe("en");
    expect(new URLSearchParams(entered).get("fullscreen")).toBe("1");

    const exited = updatePreviewFullscreenSearch(entered, false);
    expect(new URLSearchParams(exited).get("fullscreen")).toBeNull();
    expect(new URLSearchParams(exited).get("demo")).toBe("node-types");
    expect(new URLSearchParams(exited).get("lang")).toBe("en");
  });

  it("keeps the established AirApp helper aliases backward-compatible", () => {
    expect(isAirAppFullscreenSearch("fullscreen=1&demo=1")).toBe(true);
    expect(updateAirAppFullscreenSearch("demo=1", true)).toBe(
      updatePreviewFullscreenSearch("demo=1", true),
    );
  });
});
