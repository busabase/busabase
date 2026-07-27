export type McpGuideEdition = "desktop" | "cloud";
export type McpGuideLang = "en" | "zh-CN" | "ja";

/**
 * Which affordances the host has. This is what decides the instructions a user needs —
 * not the brand — so a new platform slots into an existing group instead of needing its
 * own bespoke copy.
 */
export type McpAgentKind = "shell" | "web-chat";

/**
 * Brand links shown in the Agent Skills panel, split by what the host can run.
 *
 * `shell` entries are the only ones the pasted prompt actually works in: it points at
 * `/SETUP_SKILL.md`, whose steps are `curl`/`npx`-shaped and whose final milestone is
 * `npx skills add`. Listing the web-chat brands alongside them — as that panel used to —
 * implies the prompt works there too, and it cannot: a browser tab has no shell, so the
 * agent either refuses or claims to have run commands it never ran.
 *
 * Deliberately absent: 豆包 and 元宝's own chat apps accept no third-party tools at all,
 * so their ecosystems appear here as 扣子空间 and 腾讯元器 instead.
 *
 * Per-client setup instructions are **not** kept here. They live in the MCP guide
 * (`/docs/mcp`), which has a section per client; duplicating them as UI strings gave two
 * sources of truth for the same commands and no way to notice when they drifted apart.
 */
export const AGENT_BRAND_LINKS: { name: string; url: string; kind: McpAgentKind }[] = [
  { name: "Claude Code", url: "https://claude.com/claude-code", kind: "shell" },
  { name: "Codex", url: "https://openai.com/codex", kind: "shell" },
  { name: "Gemini CLI", url: "https://github.com/google-gemini/gemini-cli", kind: "shell" },
  { name: "Cursor", url: "https://cursor.com", kind: "shell" },
  { name: "OpenClaw", url: "https://openclaw.ai", kind: "shell" },
  { name: "WorkBuddy", url: "https://copilot.tencent.com/work/", kind: "shell" },
  { name: "Buda Agent", url: "https://buda.im", kind: "shell" },
  { name: "Hermes", url: "https://hermes-agent.nousresearch.com", kind: "shell" },
  { name: "ChatGPT", url: "https://chatgpt.com", kind: "web-chat" },
  { name: "Claude.ai", url: "https://claude.ai", kind: "web-chat" },
  { name: "Gemini Spark", url: "https://gemini.google.com/apps", kind: "web-chat" },
  { name: "扣子空间", url: "https://www.coze.cn", kind: "web-chat" },
  { name: "腾讯元器", url: "https://yuanqi.tencent.com", kind: "web-chat" },
];

export interface McpPanelCopy {
  fullGuide: string;
}

const PANEL_COPY: Record<McpGuideLang, McpPanelCopy> = {
  en: { fullGuide: "Open the full setup guide for every client" },
  "zh-CN": { fullGuide: "打开各客户端的完整配置指南" },
  ja: { fullGuide: "各クライアントの完全なセットアップガイドを開く" },
};

export function resolveMcpGuideLang(lang?: string): McpGuideLang {
  return lang === "zh-CN" || lang === "ja" ? lang : "en";
}

export function getMcpPanelCopy(lang?: string): McpPanelCopy {
  return PANEL_COPY[resolveMcpGuideLang(lang)];
}

/**
 * Whether a chat app can reach this workspace at all.
 *
 * Desktop serves MCP on `http://localhost:15419`, which a hosted chat product cannot
 * resolve — its servers make the request, not the user's browser. So the Agent Skills
 * panel must not send a Desktop user to the connector: that tab would hand them a
 * localhost URL that fails with no explanation. Cloud is reachable, so the connector
 * really is the answer there.
 */
export const isWebChatReachable = (edition: McpGuideEdition): boolean => edition === "cloud";
