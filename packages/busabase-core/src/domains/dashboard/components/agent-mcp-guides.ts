import { type CoreLocale, isCoreLocale } from "../../../i18n/locales";

export type McpGuideEdition = "desktop" | "cloud";
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

export function resolveMcpGuideLang(lang?: string): CoreLocale {
  return isCoreLocale(lang) ? lang : "en";
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

/**
 * Which MCP endpoint the panel should open on for a given edition. A Cloud host
 * opening on `local` hands its visitors a `localhost:15419` URL that nothing on
 * their machine is listening to — the endpoint is only right for the edition
 * that actually runs there. Either mode stays selectable afterwards; this only
 * decides the starting point.
 */
export const defaultMcpModeFor = (edition: McpGuideEdition): McpConnectionMode =>
  edition === "cloud" ? "cloud" : "local";

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
  lang: CoreLocale,
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
        setup: (isCloud ? BUDA_CLOUD_SETUP : BUDA_LOCAL_SETUP)[lang].join("\n"),
      };
  }
};

const BUDA_CLOUD_SETUP: Record<CoreLocale, string[]> = {
  en: [
    "Buda → Settings → Integrations",
    "Choose an agent → Busabase → Connect",
    "Approve the Busabase permission grant",
  ],
  "zh-CN": ["Buda → 设置 → 集成", "选择 Agent → Busabase → 连接", "批准 Busabase 权限授权"],
  "zh-TW": ["Buda → 設定 → 整合", "選擇智能體 → Busabase → 連線", "核准 Busabase 權限授權"],
  ja: ["Buda → 設定 → 連携", "エージェントを選択 → Busabase → 接続", "Busabase の権限付与を承認"],
  ko: ["Buda → 설정 → 연동", "에이전트 선택 → Busabase → 연결", "Busabase 권한 부여 승인"],
  es: [
    "Buda → Ajustes → Integraciones",
    "Elige un agente → Busabase → Conectar",
    "Aprueba la concesión de permisos de Busabase",
  ],
  pt: [
    "Buda → Configurações → Integrações",
    "Escolha um agente → Busabase → Conectar",
    "Aprove a concessão de permissões do Busabase",
  ],
  vi: [
    "Buda → Cài đặt → Tích hợp",
    "Chọn một tác nhân AI → Busabase → Kết nối",
    "Phê duyệt việc cấp quyền cho Busabase",
  ],
  fr: [
    "Buda → Paramètres → Intégrations",
    "Choisissez un agent → Busabase → Connecter",
    "Approuvez l'octroi des autorisations Busabase",
  ],
  de: [
    "Buda → Einstellungen → Integrationen",
    "Agent auswählen → Busabase → Verbinden",
    "Busabase-Berechtigungserteilung genehmigen",
  ],
};

const BUDA_LOCAL_SETUP: Record<CoreLocale, string[]> = {
  en: [
    "Buda's built-in integration connects to Busabase Cloud.",
    "For this local workspace, use Agent Skills or another MCP client above.",
  ],
  "zh-CN": [
    "Buda 内置集成连接的是 Busabase Cloud。",
    "要连接这个本地工作区，请使用 Agent Skills 或上方其他 MCP 客户端。",
  ],
  "zh-TW": [
    "Buda 內建整合連線的是 Busabase Cloud。",
    "若要連線這個本機工作區，請使用 Agent Skills 或上方其他 MCP 用戶端。",
  ],
  ja: [
    "Buda の組み込み連携は Busabase Cloud に接続します。",
    "このローカルワークスペースには Agent Skills または上記の別の MCP クライアントを使用してください。",
  ],
  ko: [
    "Buda 내장 연동은 Busabase Cloud에 연결됩니다.",
    "이 로컬 워크스페이스에는 Agent Skills 또는 위의 다른 MCP 클라이언트를 사용하세요.",
  ],
  es: [
    "La integración incorporada de Buda se conecta a Busabase Cloud.",
    "Para este espacio de trabajo local, usa Agent Skills u otro cliente MCP de los anteriores.",
  ],
  pt: [
    "A integração nativa do Buda se conecta ao Busabase Cloud.",
    "Para este espaço de trabalho local, use o Agent Skills ou outro cliente MCP acima.",
  ],
  vi: [
    "Tích hợp có sẵn của Buda kết nối với Busabase Cloud.",
    "Với không gian làm việc cục bộ này, hãy dùng Agent Skills hoặc một máy khách MCP khác ở trên.",
  ],
  fr: [
    "L'intégration native de Buda se connecte à Busabase Cloud.",
    "Pour cet espace de travail local, utilisez Agent Skills ou un autre client MCP ci-dessus.",
  ],
  de: [
    "Die integrierte Buda-Anbindung verbindet sich mit Busabase Cloud.",
    "Für diesen lokalen Arbeitsbereich verwenden Sie Agent Skills oder einen der anderen MCP-Clients oben.",
  ],
};

const LOCAL_CONNECTION_COPY: Record<CoreLocale, Record<McpAgentId, string>> = {
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
  "zh-TW": {
    codex: "開啟 /mcp，確認 Busabase 已啟用。本機 Busabase 通常不需要登入。",
    "claude-code": "開啟 /mcp，確認 Busabase 已連線。本機 Busabase 通常不需要登入。",
    cursor: "開啟 Cursor 設定 → Tools & MCP，然後啟用 Busabase。",
    "gemini-cli": "啟動 Gemini CLI 並執行 /mcp，確認 Busabase 已連線。",
    openclaw: "執行上方的偵測指令；本機連線通常不需要 OAuth 登入。",
    hermes: "重新啟動 Hermes 或執行 /reload-mcp，載入本機伺服器。",
    workbuddy: "開啟設定 → MCP，新增設定並測試連線。",
    "buda-agent": "請選擇 Agent Skills 或上方支援本機連線的 MCP 用戶端。",
  },
  ja: {
    codex: "/mcp を開き、Busabase が有効であることを確認します。ローカルでは通常ログイン不要です。",
    "claude-code": "/mcp を開き、Busabase の接続を確認します。ローカルでは通常ログイン不要です。",
    cursor: "Cursor Settings → Tools & MCP を開き、Busabase を有効にします。",
    "gemini-cli": "Gemini CLI を起動して /mcp を実行し、接続を確認します。",
    openclaw: "上記の probe を実行します。通常 OAuth ログインは不要です。",
    hermes: "Hermes を再起動するか /reload-mcp を実行します。",
    workbuddy: "設定 → MCP で設定を追加し、接続テストを実行します。",
    "buda-agent": "Agent Skills または上記のローカル対応 MCP クライアントを使用してください。",
  },
  ko: {
    codex:
      "/mcp를 열어 Busabase가 활성화되어 있는지 확인하세요. 로컬 Busabase는 보통 로그인이 필요하지 않습니다.",
    "claude-code":
      "/mcp를 열어 Busabase가 연결되어 있는지 확인하세요. 로컬 Busabase는 보통 로그인이 필요하지 않습니다.",
    cursor: "Cursor 설정 → Tools & MCP를 열고 Busabase를 활성화하세요.",
    "gemini-cli": "Gemini CLI를 시작하고 /mcp를 실행해 Busabase가 연결되었는지 확인하세요.",
    openclaw: "위에 표시된 probe를 실행하세요. 보통 OAuth 로그인은 필요하지 않습니다.",
    hermes: "Hermes를 다시 시작하거나 /reload-mcp를 실행해 로컬 서버를 불러오세요.",
    workbuddy: "설정 → MCP를 열어 구성을 추가하고 연결을 테스트하세요.",
    "buda-agent": "Agent Skills 또는 위의 로컬을 지원하는 MCP 클라이언트 중 하나를 선택하세요.",
  },
  es: {
    codex:
      "Abre /mcp y confirma que Busabase está habilitado. Busabase local normalmente no necesita inicio de sesión.",
    "claude-code":
      "Abre /mcp y confirma que Busabase está conectado. Busabase local normalmente no necesita inicio de sesión.",
    cursor: "Abre Ajustes de Cursor → Tools & MCP y habilita Busabase.",
    "gemini-cli": "Inicia Gemini CLI y ejecuta /mcp para confirmar que Busabase está conectado.",
    openclaw:
      "Ejecuta la sonda mostrada arriba; normalmente no hace falta iniciar sesión con OAuth.",
    hermes: "Reinicia Hermes o ejecuta /reload-mcp para cargar el servidor local.",
    workbuddy: "Abre Ajustes → MCP, añade la configuración y prueba la conexión.",
    "buda-agent": "Elige Agent Skills o uno de los clientes MCP compatibles con local de arriba.",
  },
  pt: {
    codex:
      "Abra /mcp e confirme que o Busabase está ativado. O Busabase local normalmente não exige login.",
    "claude-code":
      "Abra /mcp e confirme que o Busabase está conectado. O Busabase local normalmente não exige login.",
    cursor: "Abra Configurações do Cursor → Tools & MCP e ative o Busabase.",
    "gemini-cli":
      "Inicie o Gemini CLI e execute /mcp para confirmar que o Busabase está conectado.",
    openclaw: "Execute a sonda mostrada acima; normalmente não é necessário login OAuth.",
    hermes: "Reinicie o Hermes ou execute /reload-mcp para carregar o servidor local.",
    workbuddy: "Abra Configurações → MCP, adicione a configuração e teste a conexão.",
    "buda-agent": "Escolha o Agent Skills ou um dos clientes MCP acima compatíveis com local.",
  },
  vi: {
    codex: "Mở /mcp và xác nhận Busabase đã được bật. Busabase cục bộ thường không cần đăng nhập.",
    "claude-code":
      "Mở /mcp và xác nhận Busabase đã được kết nối. Busabase cục bộ thường không cần đăng nhập.",
    cursor: "Mở Cursor Settings → Tools & MCP rồi bật Busabase.",
    "gemini-cli": "Khởi động Gemini CLI và chạy /mcp để xác nhận Busabase đã được kết nối.",
    openclaw: "Chạy lệnh probe ở trên; thường không cần đăng nhập OAuth.",
    hermes: "Khởi động lại Hermes hoặc chạy /reload-mcp để tải máy chủ cục bộ.",
    workbuddy: "Mở Cài đặt → MCP, thêm cấu hình rồi kiểm tra kết nối.",
    "buda-agent": "Hãy chọn Agent Skills hoặc một trong các máy khách MCP hỗ trợ cục bộ ở trên.",
  },
  fr: {
    codex:
      "Ouvrez /mcp et vérifiez que Busabase est activé. Busabase en local ne nécessite normalement aucune connexion.",
    "claude-code":
      "Ouvrez /mcp et vérifiez que Busabase est connecté. Busabase en local ne nécessite normalement aucune connexion.",
    cursor: "Ouvrez Paramètres de Cursor → Tools & MCP et activez Busabase.",
    "gemini-cli": "Lancez Gemini CLI et exécutez /mcp pour vérifier que Busabase est connecté.",
    openclaw:
      "Exécutez la commande probe ci-dessus ; aucune connexion OAuth n'est normalement requise.",
    hermes: "Redémarrez Hermes ou exécutez /reload-mcp pour charger le serveur local.",
    workbuddy: "Ouvrez Paramètres → MCP, ajoutez la configuration et testez la connexion.",
    "buda-agent":
      "Choisissez Agent Skills ou l'un des clients MCP compatibles avec le local ci-dessus.",
  },
  de: {
    codex:
      "Öffnen Sie /mcp und prüfen Sie, ob Busabase aktiviert ist. Lokales Busabase benötigt normalerweise keine Anmeldung.",
    "claude-code":
      "Öffnen Sie /mcp und prüfen Sie, ob Busabase verbunden ist. Lokales Busabase benötigt normalerweise keine Anmeldung.",
    cursor: "Öffnen Sie Cursor-Einstellungen → Tools & MCP und aktivieren Sie Busabase.",
    "gemini-cli":
      "Starten Sie Gemini CLI und führen Sie /mcp aus, um zu prüfen, ob Busabase verbunden ist.",
    openclaw:
      "Führen Sie den oben gezeigten Probe-Befehl aus; normalerweise ist keine OAuth-Anmeldung nötig.",
    hermes:
      "Starten Sie Hermes neu oder führen Sie /reload-mcp aus, um den lokalen Server zu laden.",
    workbuddy:
      "Öffnen Sie Einstellungen → MCP, fügen Sie die Konfiguration hinzu und testen Sie die Verbindung.",
    "buda-agent":
      "Wählen Sie Agent Skills oder einen der oben genannten MCP-Clients mit lokaler Unterstützung.",
  },
};

const CLOUD_CONNECTION_COPY: Record<CoreLocale, Record<McpAgentId, string>> = {
  en: {
    codex: "Complete browser OAuth, then open /mcp and confirm the tools are enabled.",
    "claude-code": "Complete browser OAuth from the login command or from /mcp inside Claude Code.",
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
  "zh-TW": {
    codex: "完成瀏覽器 OAuth，然後開啟 /mcp，確認工具已啟用。",
    "claude-code": "透過登入指令或 Claude Code 內的 /mcp 完成瀏覽器 OAuth。",
    cursor: "開啟 Cursor 設定 → Tools & MCP，選擇 Connect 或 Log in，並完成瀏覽器 OAuth。",
    "gemini-cli": "啟動 Gemini CLI，執行 /mcp auth busabase 完成 OAuth，再執行 /mcp。",
    openclaw: "完成瀏覽器或貼回式 OAuth 流程，然後執行偵測指令。",
    hermes: "執行 hermes mcp login busabase 完成 OAuth，再重新啟動 Hermes 或執行 /reload-mcp。",
    workbuddy: "開啟設定 → MCP，新增 Busabase，選擇 OAuth 或 Connect，並測試連線。",
    "buda-agent": "授權後返回 Buda，確認 Busabase 整合顯示為「已連線」。",
  },
  ja: {
    codex: "ブラウザーで OAuth を完了し、/mcp を開いてツールが有効であることを確認します。",
    "claude-code":
      "ログインコマンドまたは Claude Code 内の /mcp からブラウザー OAuth を完了します。",
    cursor: "Cursor Settings → Tools & MCP で Connect または Log in を選び、OAuth を完了します。",
    "gemini-cli": "Gemini CLI で /mcp auth busabase を実行して OAuth を完了し、/mcp で確認します。",
    openclaw: "ブラウザーまたはコード貼り付けの OAuth を完了し、probe を実行します。",
    hermes: "hermes mcp login busabase で OAuth を完了し、再起動または /reload-mcp を実行します。",
    workbuddy: "設定 → MCP で Busabase を追加し、OAuth または Connect を選んでテストします。",
    "buda-agent": "同意後に Buda へ戻り、Busabase が接続済みと表示されることを確認します。",
  },
  ko: {
    codex: "브라우저에서 OAuth를 완료한 다음 /mcp를 열어 도구가 활성화되었는지 확인하세요.",
    "claude-code": "로그인 명령 또는 Claude Code 안의 /mcp에서 브라우저 OAuth를 완료하세요.",
    cursor:
      "Cursor 설정 → Tools & MCP를 열고 Connect 또는 Log in을 선택한 다음 브라우저 OAuth를 완료하세요.",
    "gemini-cli":
      "Gemini CLI를 시작하고 /mcp auth busabase를 실행해 OAuth를 완료한 다음 /mcp를 실행하세요.",
    openclaw: "브라우저 또는 붙여넣기 방식의 OAuth 절차를 완료한 다음 probe를 실행하세요.",
    hermes:
      "hermes mcp login busabase를 실행해 OAuth를 완료한 다음 Hermes를 다시 시작하거나 /reload-mcp를 실행하세요.",
    workbuddy:
      "설정 → MCP를 열어 Busabase를 추가하고 OAuth 또는 Connect를 선택한 다음 연결을 테스트하세요.",
    "buda-agent": "동의 후 Buda로 돌아가 Busabase 연동이 '연결됨'으로 표시되는지 확인하세요.",
  },
  es: {
    codex:
      "Completa el OAuth en el navegador y luego abre /mcp para confirmar que las herramientas están habilitadas.",
    "claude-code":
      "Completa el OAuth en el navegador desde el comando de inicio de sesión o desde /mcp dentro de Claude Code.",
    cursor:
      "Abre Ajustes de Cursor → Tools & MCP, elige Connect o Log in y completa el OAuth en el navegador.",
    "gemini-cli":
      "Inicia Gemini CLI, ejecuta /mcp auth busabase, completa el OAuth en el navegador y luego ejecuta /mcp.",
    openclaw:
      "Completa el flujo OAuth en el navegador o con el código pegado y luego ejecuta la sonda.",
    hermes:
      "Ejecuta hermes mcp login busabase, completa el OAuth y luego reinicia Hermes o ejecuta /reload-mcp.",
    workbuddy: "Abre Ajustes → MCP, añade Busabase, elige OAuth o Connect y prueba la conexión.",
    "buda-agent":
      "Vuelve a Buda tras dar tu consentimiento y confirma que la integración de Busabase aparece como Conectado.",
  },
  pt: {
    codex:
      "Conclua o OAuth no navegador e depois abra /mcp para confirmar que as ferramentas estão ativadas.",
    "claude-code":
      "Conclua o OAuth no navegador pelo comando de login ou por /mcp dentro do Claude Code.",
    cursor:
      "Abra Configurações do Cursor → Tools & MCP, escolha Connect ou Log in e conclua o OAuth no navegador.",
    "gemini-cli":
      "Inicie o Gemini CLI, execute /mcp auth busabase, conclua o OAuth no navegador e depois execute /mcp.",
    openclaw:
      "Conclua o fluxo OAuth no navegador ou com o código colado de volta e depois execute a sonda.",
    hermes:
      "Execute hermes mcp login busabase, conclua o OAuth e depois reinicie o Hermes ou execute /reload-mcp.",
    workbuddy:
      "Abra Configurações → MCP, adicione o Busabase, escolha OAuth ou Connect e teste a conexão.",
    "buda-agent":
      "Volte ao Buda após dar o consentimento e confirme que a integração do Busabase aparece como Conectado.",
  },
  vi: {
    codex: "Hoàn tất OAuth trong trình duyệt, sau đó mở /mcp và xác nhận các công cụ đã được bật.",
    "claude-code":
      "Hoàn tất OAuth trong trình duyệt từ lệnh đăng nhập hoặc từ /mcp bên trong Claude Code.",
    cursor:
      "Mở Cursor Settings → Tools & MCP, chọn Connect hoặc Log in rồi hoàn tất OAuth trong trình duyệt.",
    "gemini-cli":
      "Khởi động Gemini CLI, chạy /mcp auth busabase, hoàn tất OAuth trong trình duyệt rồi chạy /mcp.",
    openclaw: "Hoàn tất luồng OAuth trong trình duyệt hoặc dán mã trả về, sau đó chạy lệnh probe.",
    hermes:
      "Chạy hermes mcp login busabase, hoàn tất OAuth, sau đó khởi động lại Hermes hoặc chạy /reload-mcp.",
    workbuddy: "Mở Cài đặt → MCP, thêm Busabase, chọn OAuth hoặc Connect rồi kiểm tra kết nối.",
    "buda-agent":
      "Quay lại Buda sau khi đồng ý và xác nhận tích hợp Busabase hiển thị là Đã kết nối.",
  },
  fr: {
    codex:
      "Terminez l'OAuth dans le navigateur, puis ouvrez /mcp et vérifiez que les outils sont activés.",
    "claude-code":
      "Terminez l'OAuth dans le navigateur depuis la commande de connexion ou depuis /mcp dans Claude Code.",
    cursor:
      "Ouvrez Paramètres de Cursor → Tools & MCP, choisissez Connect ou Log in, puis terminez l'OAuth dans le navigateur.",
    "gemini-cli":
      "Lancez Gemini CLI, exécutez /mcp auth busabase, terminez l'OAuth dans le navigateur, puis exécutez /mcp.",
    openclaw:
      "Terminez le flux OAuth dans le navigateur ou par collage du code, puis exécutez la commande probe.",
    hermes:
      "Exécutez hermes mcp login busabase, terminez l'OAuth, puis redémarrez Hermes ou exécutez /reload-mcp.",
    workbuddy:
      "Ouvrez Paramètres → MCP, ajoutez Busabase, choisissez OAuth ou Connect, puis testez la connexion.",
    "buda-agent":
      "Revenez dans Buda après avoir donné votre accord et vérifiez que l'intégration Busabase affiche Connecté.",
  },
  de: {
    codex:
      "Schließen Sie das OAuth im Browser ab, öffnen Sie dann /mcp und prüfen Sie, ob die Tools aktiviert sind.",
    "claude-code":
      "Schließen Sie das OAuth im Browser über den Login-Befehl oder über /mcp in Claude Code ab.",
    cursor:
      "Öffnen Sie Cursor-Einstellungen → Tools & MCP, wählen Sie Connect oder Log in und schließen Sie das OAuth im Browser ab.",
    "gemini-cli":
      "Starten Sie Gemini CLI, führen Sie /mcp auth busabase aus, schließen Sie das OAuth im Browser ab und führen Sie dann /mcp aus.",
    openclaw:
      "Schließen Sie den OAuth-Ablauf im Browser oder per Einfügen des Codes ab und führen Sie dann den Probe-Befehl aus.",
    hermes:
      "Führen Sie hermes mcp login busabase aus, schließen Sie das OAuth ab und starten Sie dann Hermes neu oder führen Sie /reload-mcp aus.",
    workbuddy:
      "Öffnen Sie Einstellungen → MCP, fügen Sie Busabase hinzu, wählen Sie OAuth oder Connect und testen Sie die Verbindung.",
    "buda-agent":
      "Kehren Sie nach der Zustimmung zu Buda zurück und prüfen Sie, dass die Busabase-Integration als Verbunden angezeigt wird.",
  },
};

const createConnectionCopy = (
  lang: CoreLocale,
  mode: McpConnectionMode,
): Record<McpAgentId, string> =>
  (mode === "local" ? LOCAL_CONNECTION_COPY : CLOUD_CONNECTION_COPY)[lang];

const LOCAL_VERIFICATION_COPY: Record<CoreLocale, string> = {
  en: "Ask the connected client to run bases_list as a read-only smoke test before proposing changes.",
  "zh-CN": "让已连接的客户端运行只读的 bases_list；确认成功后再提交变更建议。",
  "zh-TW": "請已連線的用戶端執行唯讀的 bases_list；確認成功後再提交變更建議。",
  ja: "接続したクライアントに読み取り専用の bases_list を実行させてから変更を提案します。",
  ko: "변경을 제안하기 전에 연결된 클라이언트에게 읽기 전용 스모크 테스트로 bases_list를 실행하게 하세요.",
  es: "Pide al cliente conectado que ejecute bases_list como prueba de humo de solo lectura antes de proponer cambios.",
  pt: "Peça ao cliente conectado que execute bases_list como teste rápido somente leitura antes de propor alterações.",
  vi: "Yêu cầu máy khách đã kết nối chạy bases_list như một bài kiểm tra nhanh chỉ đọc trước khi đề xuất thay đổi.",
  fr: "Demandez au client connecté d'exécuter bases_list comme test de fumée en lecture seule avant de proposer des modifications.",
  de: "Lassen Sie den verbundenen Client bases_list als schreibgeschützten Smoke-Test ausführen, bevor Sie Änderungen vorschlagen.",
};

const cloudVerificationWithSpace = (lang: CoreLocale, id: string): string =>
  (
    ({
      en: `Ask the agent to run auth_verify, confirm ${id}, then run bases_list with targetSpaceId: "${id}".`,
      "zh-CN": `让 Agent 运行 auth_verify，确认空间 ${id}，再用 targetSpaceId: "${id}" 运行 bases_list。`,
      "zh-TW": `請智能體執行 auth_verify，確認空間 ${id}，再用 targetSpaceId: "${id}" 執行 bases_list。`,
      ja: `auth_verify で ${id} を確認し、targetSpaceId: "${id}" を指定して bases_list を実行します。`,
      ko: `에이전트에게 auth_verify를 실행하게 해 스페이스 ${id}을(를) 확인한 다음, targetSpaceId: "${id}"로 bases_list를 실행하게 하세요.`,
      es: `Pide al agente que ejecute auth_verify, confirme ${id} y luego ejecute bases_list con targetSpaceId: "${id}".`,
      pt: `Peça ao agente que execute auth_verify, confirme ${id} e depois execute bases_list com targetSpaceId: "${id}".`,
      vi: `Yêu cầu tác nhân AI chạy auth_verify, xác nhận ${id}, rồi chạy bases_list với targetSpaceId: "${id}".`,
      fr: `Demandez à l'agent d'exécuter auth_verify, de confirmer ${id}, puis d'exécuter bases_list avec targetSpaceId: "${id}".`,
      de: `Lassen Sie den Agent auth_verify ausführen, ${id} bestätigen und dann bases_list mit targetSpaceId: "${id}" ausführen.`,
    }) satisfies Record<CoreLocale, string>
  )[lang];

const CLOUD_VERIFICATION_COPY: Record<CoreLocale, string> = {
  en: "Ask the agent to run auth_verify. If it returns multiple spaces, ask which space to use, then run bases_list with that targetSpaceId.",
  "zh-CN":
    "让 Agent 运行 auth_verify；如果返回多个空间，先询问要使用哪个空间，再用该 targetSpaceId 运行 bases_list。",
  "zh-TW":
    "請智能體執行 auth_verify；如果回傳多個空間，先詢問要使用哪個空間，再用該 targetSpaceId 執行 bases_list。",
  ja: "auth_verify を実行し、複数スペースが返った場合は使用するスペースを確認して、その targetSpaceId で bases_list を実行します。",
  ko: "에이전트에게 auth_verify를 실행하게 하세요. 스페이스가 여러 개 반환되면 어느 스페이스를 사용할지 물은 다음, 해당 targetSpaceId로 bases_list를 실행하게 하세요.",
  es: "Pide al agente que ejecute auth_verify. Si devuelve varios espacios, pregunta cuál usar y luego ejecuta bases_list con ese targetSpaceId.",
  pt: "Peça ao agente que execute auth_verify. Se ele retornar vários espaços, pergunte qual usar e depois execute bases_list com esse targetSpaceId.",
  vi: "Yêu cầu tác nhân AI chạy auth_verify. Nếu có nhiều không gian được trả về, hãy hỏi nên dùng không gian nào, rồi chạy bases_list với targetSpaceId đó.",
  fr: "Demandez à l'agent d'exécuter auth_verify. S'il renvoie plusieurs espaces, demandez lequel utiliser, puis exécutez bases_list avec ce targetSpaceId.",
  de: "Lassen Sie den Agent auth_verify ausführen. Wenn mehrere Spaces zurückkommen, fragen Sie nach, welcher verwendet werden soll, und führen Sie dann bases_list mit dieser targetSpaceId aus.",
};

const createVerificationCopy = (
  lang: CoreLocale,
  mode: McpConnectionMode,
  targetSpaceId?: string,
): string => {
  if (mode === "local") return LOCAL_VERIFICATION_COPY[lang];
  if (targetSpaceId) return cloudVerificationWithSpace(lang, targetSpaceId);
  return CLOUD_VERIFICATION_COPY[lang];
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
