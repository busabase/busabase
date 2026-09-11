import { Folder, Form } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  NodeAvatar,
  nodeIconForId,
  nodeIconForType,
  nodeIconGlyph,
  resolveNodeIcon,
} from "./node-icons";

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

describe("NodeAvatar", () => {
  // The list-item icon: whatever renders here is what EVERY list of a node's
  // own identity shows (Search dialog's Recent/Skills/Apps tabs, Home's
  // Recently Visited cards, …) — see the "各种这类显示" bug this guards
  // against, where the Recent tab and Home's recent list each rendered a
  // generic type icon via their own `nodeIconForType` call instead of this
  // shared resolver, so a node's real custom icon showed in Apps/Skills but
  // silently disappeared the instant the SAME node showed up in Recent.
  const renderAvatar = (node: Parameters<typeof resolveNodeIcon>[0]) =>
    renderToStaticMarkup(createElement(NodeAvatar, { node }));

  it("renders a custom emoji icon as text, not a fallback glyph", () => {
    const markup = renderAvatar({ type: "skill", icon: { type: "emoji", value: "📊" } });
    expect(markup).toContain("📊");
    expect(markup).not.toContain("<svg");
  });

  it("renders a custom attachment icon as a real <img>, not a fallback glyph", () => {
    const markup = renderAvatar({
      type: "airapp",
      icon: { type: "attachment", url: "https://example.com/app.png", attachmentId: "a1" },
    });
    expect(markup).toContain("<img");
    expect(markup).toContain('src="https://example.com/app.png"');
    expect(markup).not.toContain("<svg");
  });

  it("falls back to the type icon when the node has no custom icon", () => {
    const markup = renderAvatar({ type: "airapp" });
    expect(markup).toContain("<svg");
    expect(markup).not.toContain("<img");
  });

  it("falls back to the type icon when icon is explicitly null", () => {
    const markup = renderAvatar({ type: "airapp", icon: null });
    expect(markup).toContain("<svg");
    expect(markup).not.toContain("<img");
  });
});
