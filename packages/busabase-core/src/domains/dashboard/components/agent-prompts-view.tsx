"use client";

/**
 * Compact Agent-prompts surface: sectioned list, prompt preview, Copy, and Ask
 * Agent. Existing-node hosts may additionally expose custom-scenario CRUD;
 * create flows reuse the same viewer without management controls.
 */

import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  CUSTOM_AGENT_PROMPT_LIMITS,
  type CustomAgentPrompts,
  type CustomPromptDef,
  type CustomPromptIntent,
} from "busabase-contract/contract/node-agent-prompt-schemas";
import { Button } from "kui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "kui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { Textarea } from "kui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "kui/tooltip";
import { cn } from "kui/utils";
import { Check, Copy, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { type iString, iStringParse } from "openlib/i18n/i-string";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { useAgentIntegrationTarget } from "../agent-integration-context";
import { renderPromptForDispatch } from "../helpers/agent-prompt-dispatch";
import type { NodePrompt, NodePromptSource } from "../helpers/node-agent-prompts";
import type { AgentIntegrationTarget } from "./agent-install-panel";
import { AgentPromptAskAction } from "./agent-prompt-ask-action";
import { createSetupSkillUrl } from "./agent-skill-button";
import { DialogContent } from "./localized-dialog-content";
import { ConfirmActionDialog } from "./primitives";
import { useWorkspacePermissionLevel } from "./split-submit-button";

export interface PromptSection {
  name: string;
  source: NodePromptSource;
  items: NodePrompt[];
}

export interface AgentPromptsManagement {
  customPrompts: CustomAgentPrompts;
  canSave: boolean;
  saving: boolean;
  save: (prompts: CustomAgentPrompts) => Promise<void>;
}

interface PromptSectionLabels {
  builtIn: string;
  custom: string;
  includeEmptyCustom?: boolean;
}

/** Node custom scenarios first, then built-ins, then capability groups. */
export const buildPromptSections = (
  scenarios: NodePrompt[],
  capabilities: NodePrompt[],
  labels: PromptSectionLabels,
): PromptSection[] => {
  const builtIn = scenarios.filter((prompt) => prompt.source === "built-in-scenario");
  const custom = scenarios.filter((prompt) => prompt.source === "custom-scenario");
  const sections: PromptSection[] = [];
  if (custom.length > 0 || labels.includeEmptyCustom) {
    sections.push({ name: labels.custom, source: "custom-scenario", items: custom });
  }
  if (builtIn.length > 0) {
    sections.push({ name: labels.builtIn, source: "built-in-scenario", items: builtIn });
  }

  const capabilitySections = new Map<string, NodePrompt[]>();
  for (const prompt of capabilities) {
    const bucket = capabilitySections.get(prompt.group);
    if (bucket) bucket.push(prompt);
    else capabilitySections.set(prompt.group, [prompt]);
  }

  return [
    ...sections,
    ...[...capabilitySections.entries()].map(([name, items]) => ({
      name,
      source: "capability" as const,
      items,
    })),
  ];
};

export const flattenPromptSections = (sections: PromptSection[]): NodePrompt[] =>
  sections.flatMap((section) => section.items);

export const resolveActivePrompt = (
  sections: PromptSection[],
  selected: string | null,
): NodePrompt | undefined => {
  const prompts = flattenPromptSections(sections);
  return prompts.find((prompt) => prompt.key === selected) ?? prompts[0];
};

export const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).length;

export const createCustomPromptKey = (label: string, existingKeys: string[]): string => {
  const base =
    label
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "custom-scenario";
  const used = new Set(existingKeys);
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};

export const updateLocalizedPromptValue = (
  original: iString,
  locale: string,
  value: string,
): iString => (typeof original === "string" ? value : { ...original, [locale]: value });

export const upsertCustomPrompt = (
  prompts: CustomAgentPrompts,
  prompt: CustomPromptDef,
  mode: "create" | "edit",
): CustomAgentPrompts =>
  mode === "create"
    ? [...prompts, prompt]
    : prompts.map((current) => (current.key === prompt.key ? prompt : current));

export const removeCustomPrompt = (prompts: CustomAgentPrompts, key: string): CustomAgentPrompts =>
  prompts.filter((prompt) => prompt.key !== key);

export const selectionAfterCustomPromptDelete = (
  prompts: CustomAgentPrompts,
  deletedKey: string,
): string | null => {
  const deletedIndex = prompts.findIndex((prompt) => prompt.key === deletedKey);
  if (deletedIndex < 0) return null;
  const next = removeCustomPrompt(prompts, deletedKey)[deletedIndex];
  return next ? `custom:${next.key}` : null;
};

interface EditorState {
  mode: "create" | "edit";
  original?: CustomPromptDef;
  label: string;
  body: string;
  intent: CustomPromptIntent;
}

export function AgentPromptsView({
  scenarios,
  capabilities,
  loading = false,
  agentIntegration: agentIntegrationProp,
  askAgent,
  onHandedOff,
  management = null,
  compact = false,
}: {
  scenarios: NodePrompt[];
  capabilities: NodePrompt[];
  loading?: boolean;
  /**
   * Which Busabase to point the agent at, for the connection check appended on
   * the way out (see `renderPromptForDispatch`).
   *
   * Two ways in, mirroring how `NodeAgentPromptsDialog` takes `orpc`: hosts that
   * render this inside `BusabaseDashboard` let the context supply it, while the
   * New-item modal and the shell's sidebar dialog — which hosts mount outside
   * that provider — pass it explicitly. An explicit prop wins.
   */
  agentIntegration?: AgentIntegrationTarget;
  /**
   * Enables Ask Agent. `null` for a host that never wired oRPC (the chromeless
   * mobile WebView, SSR) — the action is then simply not offered, exactly as
   * the shell's other orpc-gated actions behave. Copy stays available to
   * everyone: pasting a prompt into your own terminal needs no permission from
   * Busabase.
   */
  askAgent: { sessionScopeId: string; orpc: BusabaseQueryUtils } | null;
  onHandedOff: () => void;
  management?: AgentPromptsManagement | null;
  /** Use the denser dimensions of the standalone Agent prompts dialog. */
  compact?: boolean;
}) {
  const messages = useCoreI18n();
  const agentIntegrationFromContext = useAgentIntegrationTarget();
  const locale = useCoreLocale();
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomPromptDef | null>(null);
  const copyAttemptRef = useRef(0);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const snippetRef = useRef<HTMLTextAreaElement>(null);

  useEffect(
    () => () => {
      copyAttemptRef.current += 1;
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    },
    [],
  );

  const permissionLevel = useWorkspacePermissionLevel();
  const canAskAgent = hasApiKeyLevel(permissionLevel, "manage");
  const canManage = Boolean(management?.canSave && hasApiKeyLevel(permissionLevel, "write"));
  const sections = useMemo(
    () =>
      buildPromptSections(scenarios, capabilities, {
        builtIn: management
          ? messages.agentPrompts.builtInScenarios
          : messages.agentPrompts.scenariosTab,
        custom: messages.agentPrompts.customScenarios,
        includeEmptyCustom: Boolean(management),
      }),
    [capabilities, management, messages, scenarios],
  );
  const active = resolveActivePrompt(sections, selected);

  const agentIntegration = agentIntegrationProp ?? agentIntegrationFromContext;
  const edition = agentIntegration?.edition;
  // A stray targetSpaceId from a host must never leak into Desktop guidance —
  // same guard `AgentInstallPanel` applies to the same field.
  const targetSpaceId = edition === "cloud" ? agentIntegration?.targetSpaceId : undefined;

  /**
   * The bytes that actually leave — body plus the connection check.
   *
   * The origin is read at dispatch time rather than at render time, and there is
   * no fallback to the host's `defaultOrigin`: that value is an SSR placeholder
   * (see `AgentInstallPanel`, which rebuilds for the same reason), and a
   * placeholder dev URL reaching a real agent is exactly the failure the
   * rebuild exists to prevent.
   */
  const dispatchText = (prompt: NodePrompt): string => {
    const origin = typeof window === "undefined" ? undefined : window.location.origin;
    return renderPromptForDispatch({
      body: prompt.body,
      connectionCheck: messages.agentPrompts.connectionCheck,
      fmt,
      leadIn: messages.agentPrompts.connectionCheckLeadIn,
      // `editionConfirmed` is true because a dashboard node is as authoritative
      // as an entry point gets: we know which edition the user is looking at,
      // so the guide should not stop to ask them again.
      setupUrl:
        edition && origin ? createSetupSkillUrl(origin, edition, true, targetSpaceId) : undefined,
      targetSpaceId,
    });
  };

  const copy = async () => {
    if (!active) return;
    const attempt = copyAttemptRef.current + 1;
    copyAttemptRef.current = attempt;
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = null;
    }
    setCopied(false);
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(dispatchText(active));
      if (copyAttemptRef.current !== attempt) return;
      setCopied(true);
      copyResetTimeoutRef.current = window.setTimeout(() => {
        if (copyAttemptRef.current === attempt) setCopied(false);
        copyResetTimeoutRef.current = null;
      }, 1800);
    } catch {
      if (copyAttemptRef.current !== attempt) return;
      setCopied(false);
      setCopyError(true);
      snippetRef.current?.focus();
    }
  };

  const beginCreate = () => {
    setEditor({ mode: "create", label: "", body: "{target}", intent: "change" });
    setSaveAttempted(false);
    setSaveError(null);
  };

  const beginEdit = (prompt: CustomPromptDef) => {
    setEditor({
      mode: "edit",
      original: prompt,
      label: iStringParse(prompt.label, locale),
      body: iStringParse(prompt.body, locale),
      intent: prompt.intent ?? "change",
    });
    setSaveAttempted(false);
    setSaveError(null);
  };

  const validation = editor
    ? !editor.label.trim()
      ? messages.agentPrompts.nameRequired
      : editor.label.trim().length > CUSTOM_AGENT_PROMPT_LIMITS.maxLabelChars
        ? messages.agentPrompts.nameTooLong
        : !editor.body.trim()
          ? messages.agentPrompts.bodyRequired
          : utf8ByteLength(editor.body) > CUSTOM_AGENT_PROMPT_LIMITS.maxBodyBytes
            ? messages.agentPrompts.bodyTooLarge
            : editor.mode === "create" &&
                (management?.customPrompts.length ?? 0) >= CUSTOM_AGENT_PROMPT_LIMITS.maxPrompts
              ? messages.agentPrompts.limitReached
              : null
    : null;

  const draftAsPrompt = (): CustomPromptDef | null => {
    if (!editor) return null;
    const key =
      editor.original?.key ??
      createCustomPromptKey(
        editor.label,
        management?.customPrompts.map((prompt) => prompt.key) ?? [],
      );
    return {
      key,
      intent: editor.intent,
      label: editor.original
        ? updateLocalizedPromptValue(editor.original.label, locale, editor.label.trim())
        : editor.label.trim(),
      body: editor.original
        ? updateLocalizedPromptValue(editor.original.body, locale, editor.body)
        : editor.body,
    };
  };

  const saveEditor = async () => {
    if (!editor || !management) return;
    setSaveAttempted(true);
    if (validation) return;
    const nextPrompt = draftAsPrompt();
    if (!nextPrompt) return;
    setSaveError(null);
    try {
      await management.save(upsertCustomPrompt(management.customPrompts, nextPrompt, editor.mode));
      setSelected(`custom:${nextPrompt.key}`);
      setEditor(null);
    } catch (caught) {
      setSaveError(presentCoreError(messages, locale, caught, messages.agentPrompts.saveFailed));
    }
  };

  const deletePrompt = async () => {
    if (!deleteTarget || !management) return;
    setActionError(null);
    try {
      await management.save(removeCustomPrompt(management.customPrompts, deleteTarget.key));
      if (active?.customKey === deleteTarget.key) {
        setSelected(selectionAfterCustomPromptDelete(management.customPrompts, deleteTarget.key));
      }
      setDeleteTarget(null);
    } catch (caught) {
      setActionError(presentCoreError(messages, locale, caught, messages.agentPrompts.saveFailed));
      setDeleteTarget(null);
    }
  };

  if (loading) {
    return (
      <div
        className="flex h-full min-h-40 items-center justify-center text-muted-foreground text-sm"
        data-testid="node-agent-prompts-loading"
      >
        {messages.common.loading}
      </div>
    );
  }

  return (
    <>
      <PromptPanel
        active={active}
        askAgentSlot={
          askAgent && canAskAgent ? (
            <AgentPromptAskAction
              onHandedOff={onHandedOff}
              orpc={askAgent.orpc}
              promptText={active ? dispatchText(active) : undefined}
              sessionScopeId={askAgent.sessionScopeId}
            />
          ) : null
        }
        canManage={canManage}
        compact={compact}
        copied={copied}
        copyError={copyError}
        management={management}
        managementError={actionError}
        onCopy={() => void copy()}
        onCreate={beginCreate}
        onDelete={setDeleteTarget}
        onEdit={beginEdit}
        onSelect={(key) => {
          setActionError(null);
          copyAttemptRef.current += 1;
          if (copyResetTimeoutRef.current !== null) {
            window.clearTimeout(copyResetTimeoutRef.current);
            copyResetTimeoutRef.current = null;
          }
          setCopied(false);
          setCopyError(false);
          setSelected(key);
        }}
        sections={sections}
        snippetRef={snippetRef}
      />

      <CustomPromptDialog
        editor={editor}
        error={saveError}
        onChange={setEditor}
        onOpenChange={(open) => {
          if (!open && !management?.saving) setEditor(null);
        }}
        onSave={() => void saveEditor()}
        saveAttempted={saveAttempted}
        saving={management?.saving ?? false}
        validation={validation}
      />

      <ConfirmActionDialog
        body={messages.agentPrompts.deleteConfirmBody.replace(
          "{name}",
          deleteTarget ? iStringParse(deleteTarget.label, locale) : "",
        )}
        confirmLabel={messages.agentPrompts.deleteScenario}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void deletePrompt()}
        open={deleteTarget !== null}
        pending={management?.saving}
        title={messages.agentPrompts.deleteConfirmTitle}
      />
    </>
  );
}

function PromptPanel({
  sections,
  active,
  onSelect,
  onCopy,
  copied,
  copyError,
  askAgentSlot,
  canManage,
  compact,
  management,
  managementError,
  onCreate,
  onEdit,
  onDelete,
  snippetRef,
}: {
  sections: PromptSection[];
  active?: NodePrompt;
  onSelect: (key: string) => void;
  onCopy: () => void;
  copied: boolean;
  /** Clipboard write failed (permission or non-secure origin) — see `copy` in `AgentPromptsView`. */
  copyError: boolean;
  askAgentSlot?: ReactNode;
  canManage: boolean;
  compact: boolean;
  management: AgentPromptsManagement | null;
  managementError: string | null;
  onCreate: () => void;
  onEdit: (prompt: CustomPromptDef) => void;
  onDelete: (prompt: CustomPromptDef) => void;
  snippetRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const messages = useCoreI18n();

  // Flat, ordered list of prompt keys backing arrow-key navigation — the
  // sections above are a purely visual grouping, so a prompt's neighbor for
  // ArrowUp/ArrowDown purposes crosses section boundaries the same way Tab
  // would if every button were reachable in document order.
  const orderedKeys = useMemo(
    () => flattenPromptSections(sections).map((prompt) => prompt.key),
    [sections],
  );
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeCustom = active?.customKey
    ? management?.customPrompts.find((prompt) => prompt.key === active.customKey)
    : undefined;

  const focusPrompt = (key: string) => {
    onSelect(key);
    const node = buttonRefs.current.get(key);
    node?.focus();
    // jsdom (unit tests) has no scrollIntoView; guard rather than pull in a polyfill.
    node?.scrollIntoView?.({ block: "nearest" });
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentKey: string) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (orderedKeys.length === 0) return;
    event.preventDefault();
    const currentIndex = orderedKeys.indexOf(currentKey);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + step + orderedKeys.length) % orderedKeys.length;
    const nextKey = orderedKeys[nextIndex];
    if (nextKey) focusPrompt(nextKey);
  };

  return (
    <div
      className={cn(
        "grid min-h-0 gap-3 sm:h-full sm:grid-cols-[minmax(0,19.5rem)_minmax(0,1fr)]",
        compact && "gap-2 sm:h-auto sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]",
      )}
    >
      <div
        className={cn(
          "max-h-[28vh] overflow-y-auto rounded-md border p-1 sm:max-h-full",
          compact && "max-h-[20vh] sm:h-80 sm:max-h-none",
        )}
      >
        {sections.map((section) => {
          const isCustom = section.source === "custom-scenario";
          return (
            <div key={`${section.source}:${section.name}`}>
              <div className="flex min-h-8 items-center justify-between gap-2 px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                <span>{section.name}</span>
                {isCustom && canManage && section.items.length > 0 ? (
                  <TooltipProvider delayDuration={250}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          aria-label={messages.agentPrompts.newCustomPrompt}
                          className="relative grid size-7 shrink-0 place-items-center rounded text-foreground before:absolute before:-inset-2 before:content-[''] hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={onCreate}
                          type="button"
                        >
                          <Plus aria-hidden className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {messages.agentPrompts.newCustomPrompt}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : null}
              </div>
              {isCustom && canManage && section.items.length === 0 ? (
                <div className="px-1 pb-1">
                  <button
                    className="flex min-h-9 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border border-dashed px-3 py-2 text-center text-muted-foreground text-xs transition-colors hover:border-foreground/40 hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={onCreate}
                    type="button"
                  >
                    <Plus aria-hidden className="size-4 shrink-0" />
                    <span>{messages.agentPrompts.addPrompt}</span>
                  </button>
                </div>
              ) : null}
              {section.items.map((prompt) => {
                const isActive = active?.key === prompt.key;
                return (
                  <div className="flex items-center" key={prompt.key}>
                    <button
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive ? "bg-muted font-medium text-foreground" : "hover:bg-muted/60",
                      )}
                      onClick={() => onSelect(prompt.key)}
                      onKeyDown={(event) => handlePromptKeyDown(event, prompt.key)}
                      ref={(node) => {
                        if (node) buttonRefs.current.set(prompt.key, node);
                        else buttonRefs.current.delete(prompt.key);
                      }}
                      title={prompt.label}
                      type="button"
                    >
                      {prompt.label}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div
        className={cn(
          "flex min-h-[24vh] flex-col overflow-hidden rounded-md border bg-muted/30 sm:min-h-0",
          compact && "h-64 min-h-0 sm:h-80",
        )}
      >
        <div className="flex min-w-0 items-center border-b bg-card/60 p-1">
          <div
            className="min-w-0 flex-1 truncate px-2 font-medium text-foreground text-sm"
            data-testid="agent-prompts-active-title"
            title={active?.label}
          >
            {active?.label}
          </div>
          <div className="flex shrink-0 items-center" data-testid="agent-prompts-toolbar-actions">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={messages.common.moreActions}
                  className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  type="button"
                >
                  <MoreHorizontal aria-hidden className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!active} onSelect={onCopy}>
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? messages.agentPrompts.copied : messages.agentPrompts.copy}
                </DropdownMenuItem>
                {activeCustom && canManage ? (
                  <>
                    <DropdownMenuItem onSelect={() => onEdit(activeCustom)}>
                      <Pencil aria-hidden />
                      {messages.agentPrompts.editScenario}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onDelete(activeCustom)} variant="destructive">
                      <Trash2 aria-hidden />
                      {messages.agentPrompts.deleteScenario}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {managementError || copyError ? (
          <div className="flex flex-col gap-1 border-b bg-card/30 px-3 py-1.5">
            {copyError ? (
              <p aria-live="polite" className="text-destructive text-xs">
                {messages.agentPrompts.copyFailed}
              </p>
            ) : null}
            {managementError ? (
              <p aria-live="polite" className="text-destructive text-xs">
                {managementError}
              </p>
            ) : null}
          </div>
        ) : null}
        <textarea
          aria-label={active?.label}
          className="min-h-[18vh] w-full flex-1 resize-none border-0 bg-transparent p-3 font-mono text-xs leading-relaxed text-foreground outline-none sm:min-h-0"
          readOnly
          ref={snippetRef}
          value={active?.body ?? ""}
        />
        <div
          className="flex min-w-0 items-start justify-end gap-2 border-t bg-card/60 p-2"
          data-testid="agent-prompts-primary-action"
        >
          {askAgentSlot}
          <Button
            aria-label={copied ? messages.agentPrompts.copied : messages.agentPrompts.copyShort}
            className="h-7 gap-1.5 px-2.5 text-xs"
            data-testid="agent-prompts-copy-button"
            disabled={!active}
            onClick={onCopy}
            size="sm"
            title={messages.agentPrompts.copy}
            type="button"
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? messages.agentPrompts.copied : messages.agentPrompts.copyShort}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CustomPromptDialog({
  editor,
  onOpenChange,
  onChange,
  onSave,
  saving,
  validation,
  saveAttempted,
  error,
}: {
  editor: EditorState | null;
  onOpenChange: (open: boolean) => void;
  onChange: (editor: EditorState) => void;
  onSave: () => void;
  saving: boolean;
  validation: string | null;
  saveAttempted: boolean;
  error: string | null;
}) {
  const messages = useCoreI18n();
  if (!editor) return null;
  const displayedError = saveAttempted && validation ? validation : error;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editor.mode === "create"
              ? messages.agentPrompts.newScenarioTitle
              : messages.agentPrompts.editScenario}
          </DialogTitle>
          <DialogDescription>{messages.agentPrompts.editorIntro}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="agent-prompt-name">{messages.agentPrompts.scenarioName}</Label>
            <Input
              autoFocus
              id="agent-prompt-name"
              maxLength={CUSTOM_AGENT_PROMPT_LIMITS.maxLabelChars}
              onChange={(event) => onChange({ ...editor, label: event.target.value })}
              placeholder={messages.agentPrompts.scenarioNamePlaceholder}
              value={editor.label}
            />
          </div>

          {editor.mode === "edit" ? (
            <fieldset className="space-y-2">
              <legend className="font-medium text-sm">{messages.agentPrompts.agentAccess}</legend>
              <div className="grid grid-cols-2 overflow-hidden rounded-md border">
                {(["read-only", "change"] as const).map((intent) => (
                  <button
                    aria-pressed={editor.intent === intent}
                    className={cn(
                      "min-h-9 border-border px-3 text-sm first:border-r",
                      editor.intent === intent
                        ? "bg-primary text-primary-foreground"
                        : "bg-card hover:bg-muted",
                    )}
                    key={intent}
                    onClick={() => onChange({ ...editor, intent })}
                    type="button"
                  >
                    {intent === "read-only"
                      ? messages.agentPrompts.readOnly
                      : messages.agentPrompts.mayMakeChanges}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="agent-prompt-body">{messages.agentPrompts.promptTemplate}</Label>
            <Textarea
              className="min-h-48 resize-y font-mono text-xs leading-relaxed"
              id="agent-prompt-body"
              onChange={(event) => onChange({ ...editor, body: event.target.value })}
              spellCheck={false}
              value={editor.body}
            />
            <div className="flex items-start justify-between gap-3 text-muted-foreground text-xs">
              <span>{messages.agentPrompts.targetHint}</span>
              <span
                className={cn(
                  "shrink-0 tabular-nums",
                  utf8ByteLength(editor.body) > CUSTOM_AGENT_PROMPT_LIMITS.maxBodyBytes &&
                    "text-destructive",
                )}
              >
                {fmt(messages.agentPrompts.byteCount, {
                  count: utf8ByteLength(editor.body),
                  limit: CUSTOM_AGENT_PROMPT_LIMITS.maxBodyBytes,
                })}
              </span>
            </div>
          </div>

          {displayedError ? (
            <p aria-live="polite" className="text-destructive text-xs">
              {displayedError}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button disabled={saving} onClick={() => onOpenChange(false)} variant="outline">
            {messages.common.cancel}
          </Button>
          <Button disabled={saving} onClick={onSave}>
            {saving
              ? messages.agentPrompts.saving
              : editor.mode === "create"
                ? messages.agentPrompts.addScenario
                : messages.agentPrompts.saveChanges}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
