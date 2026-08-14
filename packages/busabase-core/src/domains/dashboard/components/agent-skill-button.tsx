"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "kui/dialog";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "kui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { Check, Copy, ExternalLink, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  type CoreI18nMessages,
  type CoreLocale,
  coreMessagesByLocale,
  fmt,
  useCoreI18n,
} from "../../../i18n";
import {
  AGENT_BRAND_LINKS,
  createMcpAgentGuides,
  createMcpEndpoint,
  getDefaultCloudMcpBaseUrl,
  isSameMcpOrigin,
  isValidMcpBaseUrl,
  isWebChatReachable,
  LOCAL_MCP_BASE_URL,
  type McpAgentKind,
  type McpConnectionMode,
  type McpGuideEdition,
  normalizeMcpBaseUrl,
} from "./agent-mcp-guides";

interface BusabaseAgentSkillButtonProps {
  /**
   * SSR fallback origin used before the component mounts and reads
   * `window.location.origin`. Pass each host's dev port so the very first paint
   * matches (open-source defaults to 15419, cloud to 3060).
   */
  defaultOrigin?: string;
  /** Selects Cloud OAuth guidance or Desktop's local no-auth guidance. */
  edition?: McpGuideEdition;
  /** Current UI language — localizes the pasted prompt. Unknown values fall back to English. */
  lang?: string;
  /**
   * Cloud only: currently selected Busabase space. When present, the copied
   * prompt and setup URL tell the agent to use this exact space for
   * `x-busabase-space` instead of discovering/guessing a default.
   */
  targetSpaceId?: string;
  /** Host-owned plugin destinations, shared with its public navigation. */
  pluginItems?: readonly AgentIntegrationPluginItem[];
}

export interface AgentIntegrationPluginItem {
  title: string;
  description: string;
  href: string;
  icon: string;
}

export function AgentIntegrationPluginCards({
  items,
}: {
  items: readonly AgentIntegrationPluginItem[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <a
          className="group flex min-h-24 items-center gap-3 rounded-md border bg-card p-4 transition-colors hover:bg-muted/60"
          href={item.href}
          key={item.href}
          rel="noopener noreferrer"
          target="_blank"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-md border bg-background">
            <img alt="" className="size-7 object-contain" height={28} src={item.icon} width={28} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {item.title}
              <ExternalLink
                aria-hidden="true"
                className="size-3.5 text-muted-foreground transition-colors group-hover:text-foreground"
              />
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              {item.description}
            </span>
          </span>
        </a>
      ))}
    </div>
  );
}

export interface AgentIntegrationContentProps {
  defaultOrigin?: string;
  /**
   * Which edition to record as the onboarding preference. Both editions are explicit in the URL;
   * an unconfirmed discovery link still asks the user to choose inside the agent conversation.
   */
  edition?: McpGuideEdition;
  /**
   * Skip the edition dispatcher for authoritative Dashboard/local-app entry points. Homepage
   * discovery links leave this false so their edition toggle remains only a preference.
   */
  editionConfirmed?: boolean;
  /**
   * Current UI language — localizes the pasted prompt (and its framing copy) and tells
   * the agent which language to reply in. Unknown values fall back to English.
   */
  lang?: string;
  /** Cloud only: currently selected Busabase space id. */
  targetSpaceId?: string;
  /** Host-owned plugin destinations, shared with its public navigation. */
  pluginItems?: readonly AgentIntegrationPluginItem[];
}

interface AgentIntegrationDialogProps extends AgentIntegrationContentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const resolveMessages = (lang: string | undefined, fallback: CoreI18nMessages): CoreI18nMessages =>
  lang && lang in coreMessagesByLocale ? coreMessagesByLocale[lang as CoreLocale] : fallback;

export function createSetupSkillUrl(
  origin: string,
  edition: McpGuideEdition,
  editionConfirmed = false,
  targetSpaceId?: string,
): string {
  const url = new URL("/SETUP_SKILL.md", origin);
  url.searchParams.set("edition", edition);
  if (editionConfirmed) {
    url.searchParams.set("editionConfirmed", "1");
  }
  if (edition === "cloud" && targetSpaceId) {
    url.searchParams.set("space", targetSpaceId);
  }
  return url.toString();
}

/** Shared Agent Integration UI without modal chrome, for dialogs and inline surfaces. */
export function AgentIntegrationContent({
  defaultOrigin = "http://localhost:15419",
  edition = "desktop",
  editionConfirmed = false,
  lang,
  targetSpaceId,
  pluginItems = [],
}: AgentIntegrationContentProps) {
  const contextMessages = useCoreI18n();
  const messages = resolveMessages(lang, contextMessages);
  const [origin, setOrigin] = useState(defaultOrigin);
  const [copied, setCopied] = useState<string | null>(null);
  // Controlled so the chat-app panel can hand the user straight to the connector
  // instead of telling them to go find another tab themselves.
  const [transportTab, setTransportTab] = useState("skills");
  const [skillAudience, setSkillAudience] = useState<McpAgentKind>("shell");
  const [mcpMode, setMcpMode] = useState<McpConnectionMode>("local");
  const [mcpBaseUrls, setMcpBaseUrls] = useState<Record<McpConnectionMode, string>>({
    local: LOCAL_MCP_BASE_URL,
    cloud: getDefaultCloudMcpBaseUrl(defaultOrigin),
  });

  useEffect(() => {
    const browserOrigin = window.location.origin;
    setOrigin(browserOrigin);
    setMcpBaseUrls((current) => ({
      ...current,
      cloud: getDefaultCloudMcpBaseUrl(browserOrigin),
    }));
  }, []);

  const skillUrl = useMemo(
    () => createSetupSkillUrl(origin, edition, editionConfirmed, targetSpaceId),
    [edition, editionConfirmed, origin, targetSpaceId],
  );
  const webChatReachable = isWebChatReachable(edition);
  const mcpBaseUrl = mcpBaseUrls[mcpMode];
  const mcpBaseUrlFallback =
    mcpMode === "local" ? LOCAL_MCP_BASE_URL : getDefaultCloudMcpBaseUrl(origin);
  const mcpBaseUrlIsValid = isValidMcpBaseUrl(mcpBaseUrl);
  const mcpUrl = mcpBaseUrlIsValid
    ? createMcpEndpoint(mcpBaseUrl, mcpBaseUrlFallback)
    : "<BASE_URL>/api/mcp";
  const guideTargetSpaceId =
    mcpMode === "cloud" && edition === "cloud" && isSameMcpOrigin(mcpBaseUrl, origin)
      ? targetSpaceId
      : undefined;
  const mcpGuideUrl = getMcpGuideUrl(lang);
  const openApiJsonUrl = `${origin}/api/v1/openapi.json`;
  const openApiDocUrl = `${origin}/api/v1/doc`;

  const agentSkillPrompt = useMemo(
    () => createAgentSkillPrompt(skillUrl, lang, targetSpaceId),
    [skillUrl, lang, targetSpaceId],
  );
  const mcpAgentGuides = useMemo(
    () => createMcpAgentGuides({ mode: mcpMode, lang, mcpUrl, targetSpaceId: guideTargetSpaceId }),
    [guideTargetSpaceId, lang, mcpMode, mcpUrl],
  );

  const selectMcpMode = (mode: McpConnectionMode) => {
    setCopied(null);
    setMcpMode(mode);
  };

  const updateMcpBaseUrl = (value: string) => {
    setMcpBaseUrls((current) => ({ ...current, [mcpMode]: value }));
  };

  const normalizeActiveMcpBaseUrl = () => {
    const normalized = normalizeMcpBaseUrl(mcpBaseUrl, "");
    if (!normalized) return;
    const fallback = mcpMode === "local" ? LOCAL_MCP_BASE_URL : getDefaultCloudMcpBaseUrl(origin);
    updateMcpBaseUrl(normalizeMcpBaseUrl(normalized, fallback));
  };

  const copy = async (text: string, key: string) => {
    setCopied(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied("error");
    }
    window.setTimeout(() => setCopied(null), 1800);
  };

  return (
    <Tabs
      value={transportTab}
      onValueChange={setTransportTab}
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <TabsList className="w-full shrink-0">
        <TabsTrigger value="skills" className="flex-1">
          {messages.integration.agentSkills}
        </TabsTrigger>
        {pluginItems.length > 0 ? (
          <TabsTrigger value="plugin" className="flex-1">
            {messages.integration.plugin}
          </TabsTrigger>
        ) : null}
        <TabsTrigger value="mcp" className="flex-1">
          MCP
        </TabsTrigger>
        <TabsTrigger value="openapi" className="flex-1">
          {messages.integration.openapi}
        </TabsTrigger>
      </TabsList>

      {/* ── Agent Skills tab ──────────────────────────────────────── */}
      <TabsContent value="skills" className="mt-0 min-h-0 overflow-y-auto pr-1">
        <div className="grid gap-3">
          {/* Ask before handing anything over. The prompt below only works in an agent
                  that can run shell commands, so serving it unconditionally is how a
                  chat-app user ends up with an agent that claims to have run curl. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {messages.integration.audienceQuestion}
            </span>
            <div className="inline-flex overflow-hidden rounded-md border">
              {(
                [
                  { kind: "shell", label: messages.integration.audienceShell },
                  { kind: "web-chat", label: messages.integration.audienceWebChat },
                ] satisfies { kind: McpAgentKind; label: string }[]
              ).map((option) => (
                <button
                  aria-pressed={skillAudience === option.kind}
                  className={`h-8 px-3 text-xs font-medium ${
                    skillAudience === option.kind
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted"
                  }`}
                  key={option.kind}
                  onClick={() => setSkillAudience(option.kind)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="text-foreground/70">{messages.integration.worksWith}</span>
            {AGENT_BRAND_LINKS.filter((agent) => agent.kind === skillAudience).map((agent) => (
              <a
                aria-label={fmt(messages.integration.openAgentWebsite, { agent: agent.name })}
                key={agent.name}
                className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                href={agent.url}
                rel="noreferrer"
                target="_blank"
              >
                {agent.name}
              </a>
            ))}
          </div>
          {skillAudience === "shell" ? (
            <>
              <p className="text-sm text-muted-foreground">{messages.integration.skillIntro}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <a
                  aria-label={messages.integration.openSetupSkill}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-muted"
                  href={skillUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink size={13} />
                  {skillUrl}
                </a>
              </div>
              <textarea
                aria-label={messages.integration.promptLabel}
                className="min-h-[140px] resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground outline-none"
                readOnly
                value={agentSkillPrompt}
              />
              <div className="flex justify-end">
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium hover:bg-muted"
                  onClick={() => copy(agentSkillPrompt, "prompt")}
                  type="button"
                >
                  {copied === "prompt" ? <Check size={16} /> : <Copy size={16} />}
                  {copied === "prompt"
                    ? messages.integration.copied
                    : messages.integration.copyPrompt}
                </button>
              </div>
            </>
          ) : (
            <div className="grid gap-3 rounded-md border border-dashed p-4">
              {/* Sending a Desktop user to the connector would hand them the
                      localhost URL that tab shows, which a hosted chat product can
                      never resolve. Say why instead of offering a dead end. */}
              <p className="text-sm font-medium text-foreground">
                {webChatReachable
                  ? messages.integration.webChatTitle
                  : messages.integration.webChatDesktopTitle}
              </p>
              <p className="text-sm text-muted-foreground">
                {webChatReachable
                  ? messages.integration.webChatBody
                  : messages.integration.webChatDesktopBody}
              </p>
              {webChatReachable ? (
                <div>
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
                    onClick={() => {
                      selectMcpMode("cloud");
                      setTransportTab("mcp");
                    }}
                    type="button"
                  >
                    {messages.integration.webChatGoToMcp}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </TabsContent>

      {pluginItems.length > 0 ? (
        <TabsContent value="plugin" className="mt-0 min-h-0 overflow-y-auto pr-1">
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{messages.integration.pluginIntro}</p>
            <AgentIntegrationPluginCards items={pluginItems} />
          </div>
        </TabsContent>
      ) : null}

      {/* ── MCP tab ───────────────────────────────────────────────── */}
      <TabsContent value="mcp" className="mt-0 min-h-0 overflow-y-auto pr-1">
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">{messages.integration.mcpIntro}</p>
          <div className="grid items-end gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="grid gap-1">
              <span className="text-xs font-medium text-foreground">
                {messages.integration.mcpConnectionMode}
              </span>
              <div
                aria-label={messages.integration.mcpConnectionMode}
                className="inline-flex h-9 overflow-hidden rounded-md border bg-muted/30"
                role="group"
              >
                {(
                  [
                    { mode: "local", label: messages.integration.local },
                    { mode: "cloud", label: messages.integration.cloud },
                  ] satisfies { mode: McpConnectionMode; label: string }[]
                ).map((option) => (
                  <button
                    aria-pressed={mcpMode === option.mode}
                    className={`min-w-20 px-3 text-xs font-medium ${
                      mcpMode === option.mode
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                    key={option.mode}
                    onClick={() => selectMcpMode(option.mode)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="grid min-w-0 gap-1">
              <span className="text-xs font-medium text-foreground">
                {messages.integration.baseUrl}
              </span>
              <input
                aria-label={messages.integration.baseUrl}
                aria-invalid={!mcpBaseUrlIsValid}
                aria-describedby={
                  mcpBaseUrlIsValid ? undefined : "agent-integration-mcp-base-url-error"
                }
                className="h-9 min-w-0 rounded-md border bg-card px-3 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onBlur={normalizeActiveMcpBaseUrl}
                onChange={(event) => updateMcpBaseUrl(event.target.value)}
                spellCheck={false}
                type="url"
                value={mcpBaseUrl}
              />
              {!mcpBaseUrlIsValid ? (
                <span
                  className="text-xs text-destructive"
                  id="agent-integration-mcp-base-url-error"
                  role="alert"
                >
                  {messages.integration.invalidBaseUrl}
                </span>
              ) : null}
            </label>
          </div>
          <div className="grid gap-1">
            <span className="text-xs font-medium text-foreground">
              {messages.integration.streamableHttp}
            </span>
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <code className="flex-1 truncate font-mono text-xs text-foreground">{mcpUrl}</code>
              <button
                className="shrink-0 rounded p-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!mcpBaseUrlIsValid}
                onClick={() => copy(mcpUrl, "mcp-http")}
                type="button"
                aria-label={messages.integration.copyUrl}
              >
                {copied === "mcp-http" ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {mcpMode === "local"
              ? messages.integration.mcpLocalHint
              : messages.integration.mcpCloudHint}
          </p>

          <Tabs defaultValue="codex" className="grid min-h-0 gap-3">
            <div className="w-full overflow-x-auto pb-1">
              <TabsList
                aria-label={messages.integration.chooseAgent}
                className="h-10 min-w-max justify-start"
              >
                {mcpAgentGuides.map((guide) => (
                  <TabsTrigger className="shrink-0" key={guide.id} value={guide.id}>
                    {guide.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {mcpAgentGuides.map((guide) => {
              const copyKey = `mcp-setup-${guide.id}`;
              return (
                <TabsContent className="mt-0 grid gap-3" key={guide.id} value={guide.id}>
                  <section className="grid gap-2" aria-labelledby={`${guide.id}-setup-title`}>
                    <div className="flex items-center justify-between gap-2">
                      <h3
                        className="text-xs font-medium text-foreground"
                        id={`${guide.id}-setup-title`}
                      >
                        {messages.integration.quickSetup}
                      </h3>
                      <button
                        aria-label={`${messages.integration.copySetup}: ${guide.name}`}
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border bg-card px-2 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!mcpBaseUrlIsValid}
                        onClick={() => copy(guide.setup, copyKey)}
                        type="button"
                      >
                        {copied === copyKey ? <Check size={13} /> : <Copy size={13} />}
                        {copied === copyKey
                          ? messages.integration.copied
                          : messages.integration.copySetup}
                      </button>
                    </div>
                    <pre
                      className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground"
                      data-format={guide.format}
                    >
                      {guide.setup}
                    </pre>
                  </section>

                  <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
                    <section className="grid content-start gap-1">
                      <h3 className="text-xs font-medium text-foreground">
                        {messages.integration.connect}
                      </h3>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {guide.connection}
                      </p>
                    </section>
                    <section className="grid content-start gap-1">
                      <h3 className="text-xs font-medium text-foreground">
                        {messages.integration.verify}
                      </h3>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {guide.verification}
                      </p>
                    </section>
                  </div>

                  <a
                    aria-label={`${guide.name}: ${messages.integration.openFullGuide}`}
                    className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
                    href={`${mcpGuideUrl}#${guide.docAnchor}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink size={13} />
                    {guide.name}: {messages.integration.openFullGuide}
                  </a>
                </TabsContent>
              );
            })}
          </Tabs>
        </div>
      </TabsContent>

      {/* ── OpenAPI tab ───────────────────────────────────────────── */}
      <TabsContent value="openapi" className="mt-0 min-h-0 overflow-y-auto pr-1">
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">{messages.integration.openapiIntro}</p>
          <div className="grid gap-2">
            <a
              className="flex items-center justify-between rounded-md border px-3 py-2.5 text-sm hover:bg-muted"
              href={openApiDocUrl}
              rel="noreferrer"
              target="_blank"
            >
              <div className="grid gap-0.5">
                <span className="font-medium">{messages.integration.interactiveDocs}</span>
                <span className="font-mono text-xs text-muted-foreground">{openApiDocUrl}</span>
              </div>
              <ExternalLink size={15} className="shrink-0 text-muted-foreground" />
            </a>
            <div className="flex items-center gap-2 rounded-md border px-3 py-2.5">
              <div className="grid flex-1 gap-0.5">
                <span className="text-sm font-medium">{messages.integration.openapiJsonSpec}</span>
                <span className="font-mono text-xs text-muted-foreground">{openApiJsonUrl}</span>
              </div>
              <div className="flex shrink-0 gap-1">
                <a
                  className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted"
                  href={openApiJsonUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink size={13} />
                  {messages.common.open}
                </a>
                <button
                  className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted"
                  onClick={() => copy(openApiJsonUrl, "openapi-url")}
                  type="button"
                >
                  {copied === "openapi-url" ? <Check size={13} /> : <Copy size={13} />}
                  {messages.integration.copyUrl}
                </button>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>
      {copied === "error" ? (
        <p className="text-destructive text-xs" role="alert">
          {messages.integration.copyFailed}
        </p>
      ) : null}
    </Tabs>
  );
}

/**
 * Standalone integration dialog shared by the sidebar button and landing page hero.
 * Hosts may add a Plugin tab by providing their public plugin catalog.
 */
export function AgentIntegrationDialog({
  open,
  onOpenChange,
  ...contentProps
}: AgentIntegrationDialogProps) {
  const contextMessages = useCoreI18n();
  const messages = resolveMessages(contentProps.lang, contextMessages);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{messages.integration.title}</DialogTitle>
        </DialogHeader>
        <AgentIntegrationContent {...contentProps} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Sidebar footer button + integration panel shared by every Busabase host.
 * Opens the shared Agent Integration dialog.
 */
export function BusabaseAgentSkillButton({
  defaultOrigin = "http://localhost:15419",
  edition = "desktop",
  lang,
  targetSpaceId,
  pluginItems,
}: BusabaseAgentSkillButtonProps = {}) {
  const contextMessages = useCoreI18n();
  const messages = resolveMessages(lang, contextMessages);
  const [open, setOpen] = useState(false);

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="mx-2 w-[calc(100%-1rem)]"
            onClick={() => setOpen(true)}
            tooltip={messages.integration.agentSkills}
          >
            <Sparkles />
            <span>{messages.integration.agentSkills}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <AgentIntegrationDialog
        open={open}
        onOpenChange={setOpen}
        defaultOrigin={defaultOrigin}
        edition={edition}
        editionConfirmed
        lang={lang}
        targetSpaceId={targetSpaceId}
        pluginItems={pluginItems}
      />
    </>
  );
}

/** UI languages the copy-paste prompt is localized into (mirrors busabase-cloud's locales). */
type PromptLang = "en" | "zh-CN" | "ja";

function resolvePromptLang(lang?: string): PromptLang {
  return lang === "zh-CN" || lang === "ja" ? lang : "en";
}

function getMcpGuideUrl(lang?: string): string {
  const locale = resolvePromptLang(lang);
  return locale === "en"
    ? "https://busabase.com/docs/mcp"
    : `https://busabase.com/${locale}/docs/mcp`;
}

/**
 * The short, human-readable prompt the user pastes into their agent. Deliberately thin:
 * it points at SKILL.md (the single source of truth for ALL behavior), keeps the one
 * safety rule visible, and sets the agent's reply language. Everything about HOW to
 * onboard — the welcome, what-it-is, and "ask what to manage first" — lives in SKILL.md.
 */
export function createAgentSkillPrompt(
  skillUrl: string,
  lang?: string,
  targetSpaceId?: string,
): string {
  const targetLine = targetSpaceId
    ? {
        en: `\nTarget the currently selected Busabase space: ${targetSpaceId}. Use this exact ID for BUSABASE_SPACE_ID / x-busabase-space unless I explicitly choose another space.\n`,
        "zh-CN": `\n当前选中的 Busabase 空间是：${targetSpaceId}。除非我明确选择其他空间，否则请用这个 ID 作为 BUSABASE_SPACE_ID / x-busabase-space。\n`,
        ja: `\n現在選択されている Busabase スペース: ${targetSpaceId}。私が明示的に別のスペースを選ばない限り、この ID を BUSABASE_SPACE_ID / x-busabase-space に使ってください。\n`,
      }[resolvePromptLang(lang)]
    : "";

  switch (resolvePromptLang(lang)) {
    case "zh-CN":
      return `阅读并遵循 Busabase Agent Skill——它是唯一事实来源：
${skillUrl}
${targetLine}

按它的引导帮我把工作区设置好。除 Skill 明确允许的版本化 system-onboarding 示例初始化外，未经我批准绝不要合并 ChangeRequest。请用简体中文回复我。`;
    case "ja":
      return `Busabase Agent Skill を読んで従ってください——これが唯一の信頼できる情報源です：
${skillUrl}
${targetLine}

オンボーディングに従ってセットアップしてください。Skill が明示的に許可するバージョン付き system-onboarding のサンプル初期化を除き、私の承認なしに ChangeRequest をマージしないでください。日本語で返信してください。`;
    default:
      return `Read and follow the Busabase Agent Skill — it is the single source of truth:
${skillUrl}
${targetLine}

Follow its onboarding to set me up. Never merge a ChangeRequest without my approval except for the versioned system-onboarding sample initialization explicitly allowed by the Skill. Reply to me in English.`;
  }
}
