import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceAttributionInline } from "./source-attribution";

Object.assign(globalThis, { React });

describe("SourceAttributionInline", () => {
  it("distinguishes owner, credential, and channel with decorative icons", () => {
    const markup = renderToStaticMarkup(
      <SourceAttributionInline channelLabel="MCP" credentialLabel="Codex" owner="Leon" />,
    );

    expect(markup).toContain('data-attribution-kind="owner"');
    expect(markup).toContain('data-attribution-kind="credential"');
    expect(markup).toContain('data-attribution-kind="channel"');
    expect(markup.match(/<svg/g)).toHaveLength(3);
    expect(markup).toContain("Leon");
    expect(markup).toContain("via");
    expect(markup).toContain("Codex");
    expect(markup).toContain("MCP");
  });

  it("uses the channel icon instead of a credential icon when no API key name exists", () => {
    const markup = renderToStaticMarkup(
      <SourceAttributionInline channelLabel="Web UI" owner="Leon" showChannel={false} />,
    );

    expect(markup).toContain('data-attribution-kind="owner"');
    expect(markup).toContain('data-attribution-kind="channel"');
    expect(markup).not.toContain('data-attribution-kind="credential"');
    expect(markup.match(/<svg/g)).toHaveLength(2);
  });
});
