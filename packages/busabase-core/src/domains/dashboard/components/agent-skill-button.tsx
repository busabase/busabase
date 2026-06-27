"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "kui/dialog";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "kui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { Check, Copy, ExternalLink, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
   * matches (open-source defaults to 3061, cloud to 3060).
   */
  defaultOrigin?: string;
}

interface AgentIntegrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultOrigin?: string;
  /**
   * Which edition's onboarding skill to point at. "desktop" adds ?edition=desktop
   * (install + auto-detect localhost); "cloud" / omitted uses the bare /SKILL.md
   * (API-key onboarding). Lets the host pass its selected edition through.
   */
  edition?: "desktop" | "cloud";
}

/**
 * Standalone dialog with three tabs: Agent Skills, MCP, OpenAPI.
 * Shared by the sidebar button and the landing page hero.
 */
export function AgentIntegrationDialog({
  open,
  onOpenChange,
  defaultOrigin = "http://localhost:3061",
  edition,
}: AgentIntegrationDialogProps) {
  const [origin, setOrigin] = useState(defaultOrigin);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const skillUrl =
    edition === "desktop" ? `${origin}/SKILL.md?edition=desktop` : `${origin}/SKILL.md`;
  const mcpUrl = `${origin}/api/mcp`;
  const openApiJsonUrl = `${origin}/api/v1/openapi.json`;
  const openApiDocUrl = `${origin}/api/v1/doc`;

  const agentSkillPrompt = useMemo(() => createAgentSkillPrompt(skillUrl), [skillUrl]);

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1800);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-4 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Agent Integration</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="skills" className="flex flex-col gap-3">
          <TabsList className="w-full">
            <TabsTrigger value="skills" className="flex-1">
              Agent Skills
            </TabsTrigger>
            <TabsTrigger value="mcp" className="flex-1">
              MCP
            </TabsTrigger>
            <TabsTrigger value="openapi" className="flex-1">
              OpenAPI
            </TabsTrigger>
          </TabsList>

          {/* ── Agent Skills tab ──────────────────────────────────────── */}
          <TabsContent value="skills" className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Copy this prompt into your agent. It points the agent at this workspace's live
              SKILL.md, which carries the full API surface and approval-first workflow.
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="text-foreground/70">Works with</span>
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
                {copied === "prompt" ? "Copied" : "Copy prompt"}
              </button>
            </div>
          </TabsContent>

          {/* ── MCP tab ───────────────────────────────────────────────── */}
          <TabsContent value="mcp" className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Connect any MCP-compatible agent or IDE directly to this workspace via the Streamable
              HTTP or SSE transport.
            </p>
            <div className="grid gap-2">
              <div className="grid gap-1">
                <span className="text-xs font-medium text-foreground">
                  Streamable HTTP (recommended)
                </span>
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                  <code className="flex-1 truncate font-mono text-xs text-foreground">
                    {mcpUrl}
                  </code>
                  <button
                    className="shrink-0 rounded p-1 hover:bg-muted"
                    onClick={() => copy(mcpUrl, "mcp-http")}
                    type="button"
                    aria-label="Copy URL"
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
                    aria-label="Copy URL"
                  >
                    {copied === "mcp-sse" ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Add this URL to your agent's MCP server config. No auth required for local
              development.
            </p>
          </TabsContent>

          {/* ── OpenAPI tab ───────────────────────────────────────────── */}
          <TabsContent value="openapi" className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Explore or import the Busabase REST API. Use the JSON spec for code generation or
              browse the interactive docs.
            </p>
            <div className="grid gap-2">
              <a
                className="flex items-center justify-between rounded-md border px-3 py-2.5 text-sm hover:bg-muted"
                href={openApiDocUrl}
                rel="noreferrer"
                target="_blank"
              >
                <div className="grid gap-0.5">
                  <span className="font-medium">Interactive docs</span>
                  <span className="font-mono text-xs text-muted-foreground">{openApiDocUrl}</span>
                </div>
                <ExternalLink size={15} className="shrink-0 text-muted-foreground" />
              </a>
              <div className="flex items-center gap-2 rounded-md border px-3 py-2.5">
                <div className="grid flex-1 gap-0.5">
                  <span className="text-sm font-medium">OpenAPI JSON spec</span>
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
                    Open
                  </a>
                  <button
                    className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted"
                    onClick={() => copy(openApiJsonUrl, "openapi-url")}
                    type="button"
                  >
                    {copied === "openapi-url" ? <Check size={13} /> : <Copy size={13} />}
                    Copy URL
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
  defaultOrigin = "http://localhost:3061",
}: BusabaseAgentSkillButtonProps = {}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="mx-2 w-[calc(100%-1rem)]"
            onClick={() => setOpen(true)}
            tooltip="Agent Skills"
          >
            <Sparkles />
            <span>Agent Skills</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <AgentIntegrationDialog open={open} onOpenChange={setOpen} defaultOrigin={defaultOrigin} />
    </>
  );
}

function createAgentSkillPrompt(skillUrl: string) {
  return `Read the Busabase Agent Skill and follow it:
${skillUrl}

That document is the single source of truth — it has this workspace's base URL,
the full REST API surface, and the approval-first workflow. Fetch it, then drive
Busabase by opening ChangeRequests and waiting for review before merging. Never
bypass review unless I explicitly ask for a direct merge.`;
}
