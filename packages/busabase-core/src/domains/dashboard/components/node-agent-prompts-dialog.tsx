"use client";

// "Agent prompts" — per-node, copy-pasteable prompts. Two tabs, matching the two
// tiers in `helpers/node-agent-prompts`:
//   Scenarios    — curated, task-shaped, hand-written per node type
//   Capabilities — exhaustive, one per registered operation, auto-derived
//
// TWO entry points, and they are genuinely separate code surfaces — an item
// added to one does NOT show up in the other:
//   - `NodeActionsMenu`       → the "•••" dropdown on every node-detail topbar
//                               (Base / Doc / Folder / FileNode / FileTree /
//                               AirApp / rich-node). Base briefly needed its own
//                               standalone button because its header laid out
//                               individual action buttons instead of a "•••";
//                               that header now uses `NodeActionsMenu` like the
//                               rest, so the standalone button is gone.
//   - the sidebar row's "•••" → a separate `NavItemAction[]` list assembled in
//                               `dashboard-shell.tsx`; it renders through
//                               `openlib/ui/dashboard`'s `NavMain`, not through
//                               this file, so it is wired there via the
//                               `onOpenAgentPrompts` callback and opens this
//                               same dialog.
//
// Layout mirrors `agent-skill-button.tsx` (kui Dialog + Tabs + readonly textarea
// + transient "Copied" state) so the two agent-facing dialogs feel like one
// feature rather than two.

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "kui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { Check, Copy, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import {
  buildNodeAgentPrompts,
  type NodePrompt,
  type NodePromptContext,
} from "../helpers/node-agent-prompts";
import { useIsAnonymousVisitor } from "../visitor-context";

/**
 * The space id used to tell the agent which space to target. Falls back to the
 * `/dashboard/<spaceId>/…` pathname when the caller can't hand one in — every
 * dashboard route is mounted under it. Same approach as `node-share-button`.
 */
const resolveSpaceId = (spaceId?: string): string | undefined => {
  if (spaceId) return spaceId;
  if (typeof window === "undefined") return undefined;
  return window.location.pathname.split("/").filter(Boolean)[1];
};

export function NodeAgentPromptsDialog({
  open,
  onOpenChange,
  nodeId,
  nodeName,
  nodeType,
  spaceId,
  spaceName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  spaceId?: string;
  spaceName?: string;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const [resolvedSpaceId, setResolvedSpaceId] = useState<string | undefined>(spaceId);
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Pathname is only readable after mount; keep SSR output stable.
  useEffect(() => {
    setResolvedSpaceId(resolveSpaceId(spaceId));
  }, [spaceId]);

  const context: NodePromptContext = useMemo(
    () => ({ nodeType, nodeName, nodeId, spaceId: resolvedSpaceId, spaceName }),
    [nodeType, nodeName, nodeId, resolvedSpaceId, spaceName],
  );

  const { scenarios, capabilities } = useMemo(
    () => buildNodeAgentPrompts(context, locale, messages),
    [context, locale, messages],
  );

  // Open on Scenarios when the type has any, else straight to Capabilities.
  const defaultTab = scenarios.length > 0 ? "scenarios" : "capabilities";
  const [tab, setTab] = useState(defaultTab);

  // Selection is scoped to the visible tab: the preview must always come from the
  // list the user is looking at. Resolving `selected` against a merged list would
  // leave the preview stuck on the other tab's first entry after switching.
  const visible = tab === "scenarios" ? scenarios : capabilities;
  const active = visible.find((prompt) => prompt.key === selected) ?? visible[0];

  const switchTab = (next: string) => {
    setTab(next);
    setSelected(null); // fall back to the new tab's own first entry
  };

  const copy = async () => {
    if (!active) return;
    await navigator.clipboard.writeText(active.body);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-4 overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {messages.agentPrompts.title}
            <span className="ml-2 text-sm font-normal text-muted-foreground">{nodeName}</span>
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{messages.agentPrompts.intro}</p>

        <Tabs value={tab} onValueChange={switchTab} className="flex min-h-0 flex-col gap-3">
          <TabsList className="w-full">
            <TabsTrigger value="scenarios" className="flex-1">
              {messages.agentPrompts.scenariosTab}
              {scenarios.length > 0 && ` (${scenarios.length})`}
            </TabsTrigger>
            <TabsTrigger value="capabilities" className="flex-1">
              {messages.agentPrompts.capabilitiesTab} ({capabilities.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scenarios" className="min-h-0">
            {scenarios.length === 0 ? (
              <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
                {messages.agentPrompts.scenariosEmpty}
              </p>
            ) : (
              <PromptPanel
                prompts={scenarios}
                active={active}
                onSelect={setSelected}
                onCopy={copy}
                copied={copied}
                copyLabel={messages.agentPrompts.copy}
                copiedLabel={messages.agentPrompts.copied}
                grouped={false}
              />
            )}
          </TabsContent>

          <TabsContent value="capabilities" className="min-h-0">
            <PromptPanel
              prompts={capabilities}
              active={active}
              onSelect={setSelected}
              onCopy={copy}
              copied={copied}
              copyLabel={messages.agentPrompts.copy}
              copiedLabel={messages.agentPrompts.copied}
              grouped
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** List (left) + preview & copy (right). Capabilities bucket under group headings. */
function PromptPanel({
  prompts,
  active,
  onSelect,
  onCopy,
  copied,
  copyLabel,
  copiedLabel,
  grouped,
}: {
  prompts: NodePrompt[];
  active?: NodePrompt;
  onSelect: (key: string) => void;
  onCopy: () => void;
  copied: boolean;
  copyLabel: string;
  copiedLabel: string;
  grouped: boolean;
}) {
  // Preserve the order `buildNodeAgentPrompts` already sorted into.
  const groups = useMemo(() => {
    if (!grouped) return [{ name: null as string | null, items: prompts }];
    const byName = new Map<string, NodePrompt[]>();
    for (const prompt of prompts) {
      const bucket = byName.get(prompt.group);
      if (bucket) bucket.push(prompt);
      else byName.set(prompt.group, [prompt]);
    }
    return [...byName.entries()].map(([name, items]) => ({ name, items }));
  }, [prompts, grouped]);

  return (
    <div className="grid min-h-0 gap-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
      <div className="max-h-[46vh] overflow-y-auto rounded-md border p-1">
        {groups.map((group) => (
          <div key={group.name ?? "_"}>
            {group.name && (
              <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                {group.name}
              </div>
            )}
            {group.items.map((prompt) => {
              const isActive = active?.key === prompt.key;
              return (
                <button
                  className={`w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                    isActive ? "bg-muted font-medium text-foreground" : "hover:bg-muted/60"
                  }`}
                  key={prompt.key}
                  onClick={() => onSelect(prompt.key)}
                  title={prompt.label}
                  type="button"
                >
                  {prompt.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-col gap-2">
        <textarea
          className="min-h-[46vh] resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground outline-none"
          readOnly
          value={active?.body ?? ""}
        />
        <div className="flex justify-end">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted"
            onClick={onCopy}
            type="button"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? copiedLabel : copyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
