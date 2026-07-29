export type McpGuideEdition = "desktop" | "cloud";
export type McpGuideLang = "en" | "zh-CN" | "ja";
export type McpConnectionMode = "local" | "cloud";

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
 * The quick-setup panel below mirrors the checked commands in `/docs/mcp`. Keep command
 * changes synchronized with that document so the dialog remains the concise path and the
 * guide remains the complete recovery/reference path.
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

export const LOCAL_MCP_BASE_URL = "http://localhost:15419";
export const CLOUD_MCP_BASE_URL = "https://busabase.com";
export const MCP_AGENT_IDS = [
  "codex",
  "claude-code",
  "cursor",
  "gemini-cli",
  "openclaw",
  "hermes",
  "workbuddy",
  "buda-agent",
] as const;

export type McpAgentId = (typeof MCP_AGENT_IDS)[number];

export interface McpAgentGuide {
  id: McpAgentId;
  name: string;
  docAnchor: string;
  format: "bash" | "json" | "yaml" | "text";
  setup: string;
  connection: string;
  verification: string;
}

interface CreateMcpAgentGuidesOptions {
  mode: McpConnectionMode;
  lang?: string;
  mcpUrl: string;
  targetSpaceId?: string;
}

const AGENT_NAMES: Record<McpAgentId, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  "gemini-cli": "Gemini CLI",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  workbuddy: "WorkBuddy",
  "buda-agent": "Buda Agent",
};

export function resolveMcpGuideLang(lang?: string): McpGuideLang {
  return lang === "zh-CN" || lang === "ja" ? lang : "en";
}

const hasExplicitProtocol = (value: string): boolean => /^[a-z][a-z\d+.-]*:\/\//i.test(value);

const looksLikeLoopback = (value: string): boolean =>
  /^(localhost|127(?:\.\d+){3}|\[::1\])(?::|\/|$)/i.test(value);

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "::1" || /^127(?:\.\d+){3}$/.test(hostname);

export function normalizeMcpBaseUrl(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  const candidate = hasExplicitProtocol(trimmed)
    ? trimmed
    : `${looksLikeLoopback(trimmed) ? "http" : "https"}://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

export const isValidMcpBaseUrl = (value: string): boolean => normalizeMcpBaseUrl(value, "") !== "";

export const isSameMcpOrigin = (baseUrl: string, origin: string): boolean => {
  const normalizedBaseUrl = normalizeMcpBaseUrl(baseUrl, "");
  const normalizedOrigin = normalizeMcpBaseUrl(origin, "");
  return normalizedBaseUrl !== "" && normalizedBaseUrl === normalizedOrigin;
};

export function getDefaultCloudMcpBaseUrl(origin?: string): string {
  if (!origin) return CLOUD_MCP_BASE_URL;

  try {
    const url = new URL(origin);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      isLoopbackHostname(url.hostname)
    ) {
      return CLOUD_MCP_BASE_URL;
    }
    return url.origin;
  } catch {
    return CLOUD_MCP_BASE_URL;
  }
}

export function createMcpEndpoint(baseUrl: string, fallback = LOCAL_MCP_BASE_URL): string {
  return `${normalizeMcpBaseUrl(baseUrl, fallback)}/api/mcp`;
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

const jsonServerConfig = (mcpUrl: string, urlKey: "url" | "httpUrl" = "url"): string =>
  JSON.stringify(
    {
      mcpServers: {
        busabase: {
          [urlKey]: mcpUrl,
        },
      },
    },
    null,
    2,
  );

const createSetup = (
  id: McpAgentId,
  mcpUrl: string,
  mode: McpConnectionMode,
  lang: McpGuideLang,
): { format: McpAgentGuide["format"]; setup: string } => {
  const isCloud = mode === "cloud";

  switch (id) {
    case "codex":
      return {
        format: "bash",
        setup: [
          `codex mcp add busabase --url ${mcpUrl}`,
          ...(isCloud ? ["codex mcp login busabase --scopes mcp"] : []),
          "codex mcp list",
        ].join("\n"),
      };
    case "claude-code":
      return {
        format: "bash",
        setup: [
          `claude mcp add --transport http --scope user busabase ${mcpUrl}`,
          ...(isCloud ? ["claude mcp login busabase"] : []),
          "claude mcp get busabase",
        ].join("\n"),
      };
    case "cursor":
      return { format: "json", setup: jsonServerConfig(mcpUrl) };
    case "gemini-cli":
      return { format: "json", setup: jsonServerConfig(mcpUrl, "httpUrl") };
    case "openclaw":
      return {
        format: "bash",
        setup: [
          "openclaw mcp add busabase \\",
          `  --url ${mcpUrl} \\`,
          `  --transport streamable-http${isCloud ? " \\" : ""}`,
          ...(isCloud ? ["  --auth oauth \\", "  --oauth-scope mcp"] : []),
          ...(isCloud ? ["openclaw mcp login busabase"] : []),
          "openclaw mcp doctor busabase --probe",
        ].join("\n"),
      };
    case "hermes":
      return {
        format: "yaml",
        setup: [
          "mcp_servers:",
          "  busabase:",
          `    url: "${mcpUrl}"`,
          ...(isCloud ? ["    auth: oauth"] : []),
        ].join("\n"),
      };
    case "workbuddy":
      return { format: "json", setup: jsonServerConfig(mcpUrl) };
    case "buda-agent":
      return {
        format: "text",
        setup: isCloud
          ? {
              en: [
                "Buda → Settings → Integrations",
                "Choose an agent → Busabase → Connect",
                "Approve the Busabase permission grant",
              ].join("\n"),
              "zh-CN": [
                "Buda → 设置 → 集成",
                "选择 Agent → Busabase → 连接",
                "批准 Busabase 权限授权",
              ].join("\n"),
              ja: [
                "Buda → 設定 → 連携",
                "エージェントを選択 → Busabase → 接続",
                "Busabase の権限付与を承認",
              ].join("\n"),
            }[lang]
          : {
              en: [
                "Buda's built-in integration connects to Busabase Cloud.",
                "For this local workspace, use Agent Skills or another MCP client above.",
              ].join("\n"),
              "zh-CN": [
                "Buda 内置集成连接的是 Busabase Cloud。",
                "要连接这个本地工作区，请使用 Agent Skills 或上方其他 MCP 客户端。",
              ].join("\n"),
              ja: [
                "Buda の組み込み連携は Busabase Cloud に接続します。",
                "このローカルワークスペースには Agent Skills または上記の別の MCP クライアントを使用してください。",
              ].join("\n"),
            }[lang],
      };
  }
};

const createConnectionCopy = (
  lang: McpGuideLang,
  mode: McpConnectionMode,
): Record<McpAgentId, string> => {
  if (mode === "local") {
    return {
      en: {
        codex: "Open /mcp and confirm Busabase is enabled. Local Busabase normally needs no login.",
        "claude-code":
          "Open /mcp and confirm Busabase is connected. Local Busabase normally needs no login.",
        cursor: "Open Cursor Settings → Tools & MCP and enable Busabase.",
        "gemini-cli": "Start Gemini CLI and run /mcp to confirm Busabase is connected.",
        openclaw: "Run the probe shown above; no OAuth login is normally required.",
        hermes: "Restart Hermes or run /reload-mcp to load the local server.",
        workbuddy: "Open Settings → MCP, add the configuration, and test the connection.",
        "buda-agent": "Choose Agent Skills or one of the local-capable MCP clients above.",
      },
      "zh-CN": {
        codex: "打开 /mcp，确认 Busabase 已启用。本地 Busabase 通常不需要登录。",
        "claude-code": "打开 /mcp，确认 Busabase 已连接。本地 Busabase 通常不需要登录。",
        cursor: "打开 Cursor 设置 → Tools & MCP，然后启用 Busabase。",
        "gemini-cli": "启动 Gemini CLI 并运行 /mcp，确认 Busabase 已连接。",
        openclaw: "运行上方的检测命令；本地连接通常不需要 OAuth 登录。",
        hermes: "重启 Hermes 或运行 /reload-mcp，加载本地服务器。",
        workbuddy: "打开设置 → MCP，添加配置并测试连接。",
        "buda-agent": "请选择 Agent Skills 或上方支持本地连接的 MCP 客户端。",
      },
      ja: {
        codex:
          "/mcp を開き、Busabase が有効であることを確認します。ローカルでは通常ログイン不要です。",
        "claude-code":
          "/mcp を開き、Busabase の接続を確認します。ローカルでは通常ログイン不要です。",
        cursor: "Cursor Settings → Tools & MCP を開き、Busabase を有効にします。",
        "gemini-cli": "Gemini CLI を起動して /mcp を実行し、接続を確認します。",
        openclaw: "上記の probe を実行します。通常 OAuth ログインは不要です。",
        hermes: "Hermes を再起動するか /reload-mcp を実行します。",
        workbuddy: "設定 → MCP で設定を追加し、接続テストを実行します。",
        "buda-agent": "Agent Skills または上記のローカル対応 MCP クライアントを使用してください。",
      },
    }[lang];
  }

  return {
    en: {
      codex: "Complete browser OAuth, then open /mcp and confirm the tools are enabled.",
      "claude-code":
        "Complete browser OAuth from the login command or from /mcp inside Claude Code.",
      cursor:
        "Open Cursor Settings → Tools & MCP, choose Connect or Log in, and complete browser OAuth.",
      "gemini-cli":
        "Start Gemini CLI, run /mcp auth busabase, complete browser OAuth, then run /mcp.",
      openclaw: "Complete the browser or paste-back OAuth flow, then run the probe.",
      hermes:
        "Run hermes mcp login busabase, complete OAuth, then restart Hermes or run /reload-mcp.",
      workbuddy:
        "Open Settings → MCP, add Busabase, choose OAuth or Connect, and test the connection.",
      "buda-agent":
        "Return to Buda after consent and confirm the Busabase integration shows Connected.",
    },
    "zh-CN": {
      codex: "完成浏览器 OAuth，然后打开 /mcp，确认工具已启用。",
      "claude-code": "通过登录命令或 Claude Code 内的 /mcp 完成浏览器 OAuth。",
      cursor: "打开 Cursor 设置 → Tools & MCP，选择 Connect 或 Log in，并完成浏览器 OAuth。",
      "gemini-cli": "启动 Gemini CLI，运行 /mcp auth busabase 完成 OAuth，再运行 /mcp。",
      openclaw: "完成浏览器或粘贴回传 OAuth 流程，然后运行检测命令。",
      hermes: "运行 hermes mcp login busabase 完成 OAuth，再重启 Hermes 或运行 /reload-mcp。",
      workbuddy: "打开设置 → MCP，添加 Busabase，选择 OAuth 或 Connect，并测试连接。",
      "buda-agent": "授权后返回 Buda，确认 Busabase 集成显示为“已连接”。",
    },
    ja: {
      codex: "ブラウザーで OAuth を完了し、/mcp を開いてツールが有効であることを確認します。",
      "claude-code":
        "ログインコマンドまたは Claude Code 内の /mcp からブラウザー OAuth を完了します。",
      cursor: "Cursor Settings → Tools & MCP で Connect または Log in を選び、OAuth を完了します。",
      "gemini-cli":
        "Gemini CLI で /mcp auth busabase を実行して OAuth を完了し、/mcp で確認します。",
      openclaw: "ブラウザーまたはコード貼り付けの OAuth を完了し、probe を実行します。",
      hermes:
        "hermes mcp login busabase で OAuth を完了し、再起動または /reload-mcp を実行します。",
      workbuddy: "設定 → MCP で Busabase を追加し、OAuth または Connect を選んでテストします。",
      "buda-agent": "同意後に Buda へ戻り、Busabase が接続済みと表示されることを確認します。",
    },
  }[lang];
};

const createVerificationCopy = (
  lang: McpGuideLang,
  mode: McpConnectionMode,
  targetSpaceId?: string,
): string => {
  if (mode === "local") {
    return {
      en: "Ask the connected client to run bases_list as a read-only smoke test before proposing changes.",
      "zh-CN": "让已连接的客户端运行只读的 bases_list；确认成功后再提交变更建议。",
      ja: "接続したクライアントに読み取り専用の bases_list を実行させてから変更を提案します。",
    }[lang];
  }

  if (targetSpaceId) {
    return {
      en: `Ask the agent to run auth_verify, confirm ${targetSpaceId}, then run bases_list with targetSpaceId: "${targetSpaceId}".`,
      "zh-CN": `让 Agent 运行 auth_verify，确认空间 ${targetSpaceId}，再用 targetSpaceId: "${targetSpaceId}" 运行 bases_list。`,
      ja: `auth_verify で ${targetSpaceId} を確認し、targetSpaceId: "${targetSpaceId}" を指定して bases_list を実行します。`,
    }[lang];
  }

  return {
    en: "Ask the agent to run auth_verify. If it returns multiple spaces, ask which space to use, then run bases_list with that targetSpaceId.",
    "zh-CN":
      "让 Agent 运行 auth_verify；如果返回多个空间，先询问要使用哪个空间，再用该 targetSpaceId 运行 bases_list。",
    ja: "auth_verify を実行し、複数スペースが返った場合は使用するスペースを確認して、その targetSpaceId で bases_list を実行します。",
  }[lang];
};

export function createMcpAgentGuides({
  mode,
  lang,
  mcpUrl,
  targetSpaceId,
}: CreateMcpAgentGuidesOptions): McpAgentGuide[] {
  const resolvedLang = resolveMcpGuideLang(lang);
  const connectionCopy = createConnectionCopy(resolvedLang, mode);
  const verification = createVerificationCopy(resolvedLang, mode, targetSpaceId);

  return MCP_AGENT_IDS.map((id) => {
    const { format, setup } = createSetup(id, mcpUrl, mode, resolvedLang);
    return {
      id,
      name: AGENT_NAMES[id],
      docAnchor: id,
      format,
      setup,
      connection: connectionCopy[id],
      verification,
    };
  });
}
