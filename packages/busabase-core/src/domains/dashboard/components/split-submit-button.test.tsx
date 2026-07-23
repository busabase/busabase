import { describe, expect, it } from "vitest";
import { resolveSubmitActionOrder } from "./split-submit-button";

describe("resolveSubmitActionOrder", () => {
  it("defaults write-capable users to Now with Change Request in the dropdown", () => {
    expect(resolveSubmitActionOrder("manage")).toEqual(["immediate", "changeRequest"]);
    expect(resolveSubmitActionOrder("write")).toEqual(["immediate", "changeRequest"]);
  });

  it("allows callers to make Change Request the primary action", () => {
    expect(resolveSubmitActionOrder("manage", "changeRequest")).toEqual([
      "changeRequest",
      "immediate",
    ]);
  });

  it("shows only Change Request for members and nothing for viewers", () => {
    expect(resolveSubmitActionOrder("changeRequest")).toEqual(["changeRequest"]);
    expect(resolveSubmitActionOrder("read")).toEqual([]);
  });
});
