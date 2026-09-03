import { describe, expect, it } from "vitest";
import { AIRAPP_PREVIEW_IFRAME_SANDBOX } from "../src/domains/airapp/utils/preview-sandbox";

describe("AirApp preview iframe sandbox", () => {
  const permissions = AIRAPP_PREVIEW_IFRAME_SANDBOX.split(" ");

  it("allows AirApp forms to submit", () => {
    expect(permissions).toContain("allow-forms");
  });

  it("limits the preview to the reviewed sandbox capabilities", () => {
    expect(permissions).toEqual([
      "allow-same-origin",
      "allow-scripts",
      "allow-forms",
      "allow-popups",
      "allow-popups-to-escape-sandbox",
    ]);
  });
});
