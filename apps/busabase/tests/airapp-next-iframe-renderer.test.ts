import { createRequire } from "node:module";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { AirAppPreviewViewport } from "../../../packages/busabase-core/src/domains/airapp/components/AirAppPreviewViewport";

const require = createRequire(import.meta.url);
// Next ships its own React renderer. Testing the workspace renderer alone missed
// its boolean-attribute handling and allowed deployed Sites to remain COEP-blocked.
const { renderToStaticMarkup } =
  require("next/dist/compiled/react-dom/server") as typeof import("react-dom/server");

describe("AirApp iframe rendering in the actual Next renderer", () => {
  it("retains the public iframe's credentialless opt-in", () => {
    const html = renderToStaticMarkup(
      createElement(AirAppPreviewViewport, {
        credentialless: true,
        src: "https://published.example.test/",
        title: "Deployed Site",
      }),
    );

    expect(html).toMatch(/<iframe\b[^>]*\bcredentialless=""/);
  });

  it("keeps the private preview in its authenticated credential context", () => {
    const html = renderToStaticMarkup(
      createElement(AirAppPreviewViewport, {
        src: "/api/airapp-preview/private-app/",
        title: "Private preview",
      }),
    );

    expect(html).toContain('src="/api/airapp-preview/private-app/"');
    expect(html).not.toMatch(/\bcredentialless\b/);
  });
});
