import { describe, expect, it } from "vitest";
import { AIRAPP_PREVIEW_IFRAME_SANDBOX } from "../src/domains/airapp/utils/preview-sandbox";

describe("AirApp preview iframe sandbox", () => {
  it("allows popup-based external navigation without leaving the sandbox origin", () => {
    expect(AIRAPP_PREVIEW_IFRAME_SANDBOX.split(" ")).toEqual(
      expect.arrayContaining([
        "allow-same-origin",
        "allow-scripts",
        "allow-popups",
        "allow-popups-to-escape-sandbox",
      ]),
    );
  });
});
