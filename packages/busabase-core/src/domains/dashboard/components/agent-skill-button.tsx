"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "kui/dialog";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "kui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { Check, Copy, ExternalLink, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useCoreI18n } from "../../../i18n";

// Agents the SKILL.md prompt can be pasted into. Brand names — shown as quick links
// so users can jump to whichever agent they use. Generic across all hosts.
const AGENTS: { name: string; url: string }[] = [
  { name: "Claude Code", url: "https://claude.com/claude-code" },
  { name: "Codex", url: "https://openai.com/codex" },
  { name: "Gemini CLI", url: "https://github.com/google-gemini/gemini-cli" },
  { name: "Cursor", url: "https://cursor.com" },
  { name: "OpenClaw", url: "https://openclaw.ai" },
  { name: "Buda Agent", url: "https://buda.im" },
  { name: "Hermes", url: "https://hermes-agent.nousresearch.com" },
];

interface BusabaseAgentSkillButtonProps {
  /**
   * SSR fallback origin used before the component mounts and reads
   * `window.location.origin`. Pass each host's dev port so the very first paint
   * matches (open-source defaults to 15419, cloud to 3060).
   */
  defaultOrigin?: string;
  /** Current UI language — localizes the pasted prompt. Unknown values fall back to English. */
  lang?: string;
}

interface AgentIntegrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultOrigin?: string;
  /**
   * Which edition's onboarding skill to point at. "desktop" adds ?edition=desktop
   * (install + auto-detect localhost); "cloud" / omitted uses the bare /SETUP_SKILL.md
   * (API-key onboarding). Lets the host pass its selected edition through.
   */
  edition?: "desktop" | "cloud";
  /**
   * Current UI language — localizes the pasted prompt (and its framing copy) and tells
   * the agent which language to reply in. Unknown values fall back to English.
   */
  lang?: string;
}

/**
 * Standalone dialog with three tabs: Agent Skills, MCP, OpenAPI.
 * Shared by the sidebar button and the landing page hero.
 */
export function AgentIntegrationDialog({
  open,
  onOpenChange,
  defaultOrigin = "http://localhost:15419",
  edition,
  lang,
}: AgentIntegrationDialogProps) {
  const messages = useCoreI18n();
  const [origin, setOrigin] = useState(defaultOrigin);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const tabCopy = SKILLS_TAB_COPY[resolvePromptLang(lang)];
  const skillUrl =
    edition === "desktop" ? `${origin}/SETUP_SKILL.md?edition=desktop` : `${origin}/SETUP_SKILL.md`;
  const mcpUrl = `${origin}/api/mcp`;
  const openApiJsonUrl = `${origin}/api/v1/openapi.json`;
  const openApiDocUrl = `${origin}/api/v1/doc`;

  const agentSkillPrompt = useMemo(() => createAgentSkillPrompt(skillUrl, lang), [skillUrl, lang]);

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1800);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-4 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{messages.integration.title}</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="skills" className="flex flex-col gap-3">
          <TabsList className="w-full">
            <TabsTrigger value="skills" className="flex-1">
              {messages.integration.agentSkills}
            </TabsTrigger>
            <TabsTrigger value="mcp" className="flex-1">
              MCP
            </TabsTrigger>
            <TabsTrigger value="openapi" className="flex-1">
              {messages.integration.openapi}
            </TabsTrigger>
          </TabsList>

          {/* ── Agent Skills tab ──────────────────────────────────────── */}
          <TabsContent value="skills" className="grid gap-3">
            <p className="text-sm text-muted-foreground">{tabCopy.intro}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="text-foreground/70">{messages.integration.worksWith}</span>
              {AGENTS.map((agent) => (
                <a
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
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <a
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
              className="min-h-[140px] resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground outline-none"
              readOnly
              value={agentSkillPrompt}
            />
            <div className="flex justify-end">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted"
                onClick={() => copy(agentSkillPrompt, "prompt")}
                type="button"
              >
                {copied === "prompt" ? <Check size={16} /> : <Copy size={16} />}
                {copied === "prompt" ? tabCopy.copied : tabCopy.copy}
              </button>
            </div>
          </TabsContent>

          {/* ── MCP tab ───────────────────────────────────────────────── */}
          <TabsContent value="mcp" className="grid gap-3">
            <p className="text-sm text-muted-foreground">{messages.integration.mcpIntro}</p>
            <div className="grid gap-2">
              <div className="grid gap-1">
                <span className="text-xs font-medium text-foreground">
                  {messages.integration.streamableHttp}
                </span>
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                  <code className="flex-1 truncate font-mono text-xs text-foreground">
                    {mcpUrl}
                  </code>
                  <button
                    className="shrink-0 rounded p-1 hover:bg-muted"
                    onClick={() => copy(mcpUrl, "mcp-http")}
                    type="button"
                    aria-label={messages.integration.copyUrl}
                  >
                    {copied === "mcp-http" ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
              <div className="grid gap-1">
                <span className="text-xs font-medium text-foreground">SSE</span>
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                  <code className="flex-1 truncate font-mono text-xs text-foreground">
                    {mcpUrl}/sse
                  </code>
                  <button
                    className="shrink-0 rounded p-1 hover:bg-muted"
                    onClick={() => copy(`${mcpUrl}/sse`, "mcp-sse")}
                    type="button"
                    aria-label={messages.integration.copyUrl}
                  >
                    {copied === "mcp-sse" ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{messages.integration.mcpHint}</p>
          </TabsContent>

          {/* ── OpenAPI tab ───────────────────────────────────────────── */}
          <TabsContent value="openapi" className="grid gap-3">
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
                  <span className="text-sm font-medium">
                    {messages.integration.openapiJsonSpec}
                  </span>
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
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Sidebar footer button + integration panel shared by every Busabase host.
 * Opens a dialog with three tabs: Agent Skills, MCP, OpenAPI.
 */
export function BusabaseAgentSkillButton({
  defaultOrigin = "http://localhost:15419",
  lang,
}: BusabaseAgentSkillButtonProps = {}) {
  const messages = useCoreI18n();
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
        lang={lang}
      />
    </>
  );
}

/** UI languages the copy-paste prompt is localized into (mirrors busabase-cloud's locales). */
type PromptLang = "en" | "zh-CN" | "ja";

function resolvePromptLang(lang?: string): PromptLang {
  return lang === "zh-CN" || lang === "ja" ? lang : "en";
}

/** Skills-tab framing copy (everything around the prompt), per language. */
const SKILLS_TAB_COPY: Record<PromptLang, { intro: string; copy: string; copied: string }> = {
  en: {
    intro:
      "Copy this prompt into your agent. It points the agent at this workspace's onboarding skill (SETUP_SKILL.md), which walks it through connecting and then installs the permanent busabase skill.",
    copy: "Copy prompt",
    copied: "Copied",
  },
  "zh-CN": {
    intro:
      "把这段提示词复制到你的 agent。它会让 agent 指向本工作区的引导 skill(SETUP_SKILL.md)—— 带它连上,并安装常驻的 busabase skill。",
    copy: "复制提示词",
    copied: "已复制",
  },
  ja: {
    intro:
      "このプロンプトをエージェントにコピーしてください。ワークスペースのオンボーディング skill(SETUP_SKILL.md)に案内し、接続を導いたうえで常設の busabase skill をインストールします。",
    copy: "プロンプトをコピー",
    copied: "コピーしました",
  },
};

/**
 * The short, human-readable prompt the user pastes into their agent. Deliberately thin:
 * it points at SKILL.md (the single source of truth for ALL behavior), keeps the one
 * safety rule visible, and sets the agent's reply language. Everything about HOW to
 * onboard — the welcome, what-it-is, and "ask what to manage first" — lives in SKILL.md.
 */
function createAgentSkillPrompt(skillUrl: string, lang?: string): string {
  switch (resolvePromptLang(lang)) {
    case "zh-CN":
      return `阅读并遵循 Busabase Agent Skill——它是唯一事实来源：
${skillUrl}

按它的引导帮我把工作区设置好；未经我批准，绝不要合并 ChangeRequest。请用简体中文回复我。`;
    case "ja":
      return `Busabase Agent Skill を読んで従ってください——これが唯一の信頼できる情報源です：
${skillUrl}

オンボーディングに従って私をセットアップし、私の承認なしに ChangeRequest をマージしないでください。日本語で返信してください。`;
    default:
      return `Read and follow the Busabase Agent Skill — it is the single source of truth:
${skillUrl}

Follow its onboarding to set me up, and never merge a ChangeRequest without my approval. Reply to me in English.`;
  }
}
