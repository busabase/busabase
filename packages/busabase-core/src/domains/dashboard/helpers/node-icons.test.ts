import { Folder, Form } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { nodeIconForId, nodeIconForType, nodeIconGlyph, resolveNodeIcon } from "./node-icons";

const renderNodeIcon = (node: Parameters<typeof resolveNodeIcon>[0]) => {
  const Glyph = nodeIconGlyph(resolveNodeIcon(node));
  return renderToStaticMarkup(createElement(Glyph));
};

describe("node icons", () => {
  it("uses the Lucide Form icon for Form nodes", () => {
    expect(nodeIconForType("form")).toBe(Form);
    expect(nodeIconForId("form")).toBe(Form);
    expect(nodeIconForType("form")).not.toBe(Folder);
  });

  it("clips an AirApp attachment icon to app-style rounded corners", () => {
    const markup = renderNodeIcon({
      type: "airapp",
      icon: {
        type: "attachment",
        url: "https://example.com/app.png",
        attachmentId: "app-icon",
      },
    });

    expect(markup).toContain("<clipPath");
    expect(markup).toContain('rx="5"');
    expect(markup).toMatch(/<image[^>]+clip-path="url\(#[^)]+\)"/);
  });

  it("leaves attachment icons for other node types square", () => {
    const markup = renderNodeIcon({
      type: "file",
      icon: {
        type: "attachment",
        url: "https://example.com/file.png",
        attachmentId: "file-icon",
      },
    });

    expect(markup).toContain("<image");
    expect(markup).not.toContain("<clipPath");
    expect(markup).not.toContain("clip-path");
  });

  it("leaves an AirApp's default type icon unchanged", () => {
    const markup = renderNodeIcon({ type: "airapp" });

    expect(markup).not.toContain("<image");
    expect(markup).not.toContain("<clipPath");
  });
});
