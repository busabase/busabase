import { describe, expect, it } from "vitest";
import {
  AGENT_BRAND_LINKS,
  CLOUD_MCP_BASE_URL,
  createMcpAgentGuides,
  createMcpEndpoint,
  getDefaultCloudMcpBaseUrl,
  isSameMcpOrigin,
  isValidMcpBaseUrl,
  isWebChatReachable,
  LOCAL_MCP_BASE_URL,
  MCP_AGENT_IDS,
  normalizeMcpBaseUrl,
  resolveMcpGuideLang,
} from "./agent-mcp-guides";

describe("MCP endpoint selection", () => {
  it("defaults Local to Desktop and Cloud to production on loopback hosts", () => {
    expect(LOCAL_MCP_BASE_URL).toBe("http://localhost:15419");
    expect(CLOUD_MCP_BASE_URL).toBe("https://busabase.com");
    expect(getDefaultCloudMcpBaseUrl("http://localhost:3000")).toBe(CLOUD_MCP_BASE_URL);
    expect(getDefaultCloudMcpBaseUrl("http://127.0.0.1:3060")).toBe(CLOUD_MCP_BASE_URL);
  });

  it("uses the current non-local Cloud origin and always generates /api/mcp", () => {
    expect(getDefaultCloudMcpBaseUrl("https://preview.example.dev/dashboard")).toBe(
      "https://preview.example.dev",
    );
    expect(createMcpEndpoint("https://preview.example.dev/")).toBe(
      "https://preview.example.dev/api/mcp",
    );
  });

  it("normalizes editable Base URLs without accepting other protocols", () => {
    expect(normalizeMcpBaseUrl(" localhost:15419/ ", CLOUD_MCP_BASE_URL)).toBe(LOCAL_MCP_BASE_URL);
    expect(normalizeMcpBaseUrl("workspace.example/path", LOCAL_MCP_BASE_URL)).toBe(
      "https://workspace.example",
    );
    expect(normalizeMcpBaseUrl("file:///tmp/busabase", LOCAL_MCP_BASE_URL)).toBe(
      LOCAL_MCP_BASE_URL,
    );
    expect(isValidMcpBaseUrl("https://workspace.example")).toBe(true);
    expect(isValidMcpBaseUrl("not a host")).toBe(false);
  });

  it("only treats the same origin as safe for a host-selected space id", () => {
    expect(isSameMcpOrigin("https://busabase.com/", "https://busabase.com/dashboard")).toBe(true);
    expect(isSameMcpOrigin("https://other.example", "https://busabase.com")).toBe(false);
    expect(isSameMcpOrigin("invalid value", "https://busabase.com")).toBe(false);
  });
});

describe("agent-specific MCP guides", () => {
  it("keeps all requested agents in the exact quick-tab order", () => {
    const guides = createMcpAgentGuides({
      mode: "cloud",
      mcpUrl: "https://busabase.example/api/mcp",
    });

    expect(guides.map((guide) => guide.id)).toEqual(MCP_AGENT_IDS);
    expect(guides.map((guide) => guide.docAnchor)).toEqual(MCP_AGENT_IDS);
    expect(guides.map((guide) => guide.name)).toEqual([
      "Codex",
      "Claude Code",
      "Cursor",
      "Gemini CLI",
      "OpenClaw",
      "Hermes",
      "WorkBuddy",
      "Buda Agent",
    ]);
  });

  it("uses the active Cloud endpoint and the checked client-specific OAuth shapes", () => {
    const mcpUrl = "https://workspace.example/api/mcp";
    const guides = createMcpAgentGuides({ mode: "cloud", mcpUrl });
    const guideFor = (id: (typeof MCP_AGENT_IDS)[number]) =>
      guides.find((guide) => guide.id === id);

    expect(guideFor("codex")?.setup).toContain(`codex mcp add busabase --url ${mcpUrl}`);
    expect(guideFor("codex")?.setup).toContain("codex mcp login busabase --scopes mcp");
    expect(guideFor("claude-code")?.setup).toContain(
      `claude mcp add --transport http --scope user busabase ${mcpUrl}`,
    );
    expect(guideFor("claude-code")?.setup).toContain("claude mcp login busabase");
    expect(guideFor("cursor")?.setup).toContain(`"url": "${mcpUrl}"`);
    expect(guideFor("gemini-cli")?.setup).toContain(`"httpUrl": "${mcpUrl}"`);
    expect(guideFor("openclaw")?.setup).toContain("--transport streamable-http");
    expect(guideFor("openclaw")?.setup).toContain("--auth oauth");
    expect(guideFor("openclaw")?.setup).toContain("--oauth-scope mcp");
    expect(guideFor("hermes")?.setup).toContain("auth: oauth");
    expect(guideFor("hermes")?.connection).toContain("hermes mcp login busabase");
    expect(guideFor("workbuddy")?.setup).toContain(`"url": "${mcpUrl}"`);
    expect(guides.map((guide) => guide.setup).join("\n")).not.toContain("Authorization");
  });

  it("omits OAuth actions from Local setup and verifies with read-only bases_list", () => {
    const guides = createMcpAgentGuides({
      mode: "local",
      mcpUrl: "http://localhost:15419/api/mcp",
    });
    const setup = guides
      .map((guide) => guide.setup)
      .join("\n")
      .toLowerCase();

    expect(setup).not.toContain("mcp login");
    expect(setup).not.toContain("auth: oauth");
    expect(setup).not.toContain("--auth oauth");
    expect(guides.find((guide) => guide.id === "codex")?.connection).toContain(
      "normally needs no login",
    );
    expect(guides.find((guide) => guide.id === "buda-agent")?.setup).toContain(
      "use Agent Skills or another MCP client",
    );
    for (const guide of guides) {
      expect(guide.verification).toContain("bases_list");
      expect(guide.verification).not.toContain("auth_verify");
    }
  });

  it("uses auth_verify, an explicit space choice, targetSpaceId, and bases_list on Cloud", () => {
    const genericGuides = createMcpAgentGuides({
      mode: "cloud",
      mcpUrl: "https://other.example/api/mcp",
    });
    const selectedGuides = createMcpAgentGuides({
      mode: "cloud",
      mcpUrl: "https://busabase.com/api/mcp",
      targetSpaceId: "space_selected",
    });

    for (const guide of genericGuides) {
      expect(guide.verification).toContain("auth_verify");
      expect(guide.verification).toContain("ask which space");
      expect(guide.verification).toContain("targetSpaceId");
      expect(guide.verification).toContain("bases_list");
    }
    for (const guide of selectedGuides) {
      expect(guide.verification).toContain("auth_verify");
      expect(guide.verification).toContain('targetSpaceId: "space_selected"');
      expect(guide.verification).toContain("bases_list");
    }
  });

  it("localizes guide content and falls back to English for unknown locales", () => {
    const zhGuide = createMcpAgentGuides({
      mode: "local",
      lang: "zh-CN",
      mcpUrl: "http://localhost:15419/api/mcp",
    })[0];
    const jaGuide = createMcpAgentGuides({
      mode: "cloud",
      lang: "ja",
      mcpUrl: "https://busabase.com/api/mcp",
    })[0];

    expect(resolveMcpGuideLang("fr")).toBe("en");
    expect(zhGuide.connection).toContain("不需要登录");
    expect(zhGuide.verification).toContain("只读");
    expect(jaGuide.connection).toContain("OAuth");
    expect(jaGuide.verification).toContain("auth_verify");
  });
});

describe("Agent Skills audience routing", () => {
  it("keeps shell and web-chat brands classified and blocks Desktop web chat", () => {
    const shell = AGENT_BRAND_LINKS.filter((link) => link.kind === "shell").map(
      (link) => link.name,
    );
    const webChat = AGENT_BRAND_LINKS.filter((link) => link.kind === "web-chat").map(
      (link) => link.name,
    );

    expect(shell.length + webChat.length).toBe(AGENT_BRAND_LINKS.length);
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
    for (const link of AGENT_BRAND_LINKS) {
      expect(link.url).toMatch(/^https:\/\//);
      expect(link.name.trim()).toBe(link.name);
    }
    expect(isWebChatReachable("desktop")).toBe(false);
    expect(isWebChatReachable("cloud")).toBe(true);
  });
});
