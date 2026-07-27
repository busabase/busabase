import { describe, expect, it } from "vitest";
import { AGENT_BRAND_LINKS, getMcpPanelCopy, resolveMcpGuideLang } from "./agent-mcp-guides";

const namesOfKind = (kind: string) =>
  AGENT_BRAND_LINKS.filter((link) => link.kind === kind).map((link) => link.name);

describe("agent brand links", () => {
  it("never lists a chat app as somewhere the shell prompt works", () => {
    // The Agent Skills panel filters this list by the audience the user picked. If a
    // web-chat brand leaked into the shell group, that panel would go back to implying
    // its curl/npx prompt works in a browser tab — the exact failure this split fixes.
    const shell = namesOfKind("shell");
    const webChat = namesOfKind("web-chat");

    expect(shell).toEqual([
      "Claude Code",
      "Codex",
      "Gemini CLI",
      "Cursor",
      "OpenClaw",
      "WorkBuddy",
      "Buda Agent",
      "Hermes",
    ]);
    expect(webChat).toEqual(["ChatGPT", "Claude.ai", "Gemini Spark", "扣子空间", "腾讯元器"]);
    expect(shell.filter((name) => webChat.includes(name))).toEqual([]);
  });

  it("classifies every brand, so none renders in neither group", () => {
    // The panel shows one group at a time. An entry with an unrecognised kind would be
    // silently invisible in both, which reads as "we don't support it".
    expect(namesOfKind("shell").length + namesOfKind("web-chat").length).toBe(
      AGENT_BRAND_LINKS.length,
    );
    for (const link of AGENT_BRAND_LINKS) {
      expect(link.url).toMatch(/^https:\/\//);
      expect(link.name.trim()).toBe(link.name);
    }
  });

  it("localizes the guide link and falls back to English for unknown locales", () => {
    expect(resolveMcpGuideLang("zh-CN")).toBe("zh-CN");
    expect(resolveMcpGuideLang("ja")).toBe("ja");
    expect(resolveMcpGuideLang("fr")).toBe("en");
    expect(getMcpPanelCopy("zh-CN").fullGuide).toBe("打开各客户端的完整配置指南");
    expect(getMcpPanelCopy("fr")).toEqual(getMcpPanelCopy("en"));
  });
});
