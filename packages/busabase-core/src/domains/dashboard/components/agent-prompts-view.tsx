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
import {
  type AgentPromptEnvelope,
  AgentPromptEnvelopeSchema,
} from "busabase-contract/domains/agents/prompt-context";
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
import {
  Check,
  ChevronRight,
  Copy,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { type iString, iStringParse } from "openlib/i18n/i-string";
import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { useAgentIntegrationTarget } from "../agent-integration-context";
import { copyAgentPromptSnapshot } from "../helpers/agent-prompt-clipboard";
import {
  joinPromptSegments,
  type PromptSegment,
  renderPromptSegments,
} from "../helpers/agent-prompt-dispatch";
import { type NodePrompt, stripTargetPlaceholderLines } from "../helpers/node-agent-prompts";
import {
  BUILT_IN_PROMPTS_EXPANDED_STORAGE_KEY,
  buildPromptSections,
  flattenPromptSections,
  type PromptSection,
  resolveActivePrompt,
  splitBuiltInSections,
} from "../helpers/prompt-sections";
import { fillPromptSlots, type PromptSlot, parsePromptTemplate } from "../helpers/prompt-slots";
import {
  partitionRecentPrompts,
  pushRecentPromptKey,
  type RecentPromptsContext,
  readRecentPromptKeys,
  recentPromptsStorageKey,
  writeRecentPromptKeys,
} from "../helpers/recent-prompts";
import { type AgentLocator, useCopyLocator } from "../hooks/use-copy-locator";
import type { AgentIntegrationTarget } from "./agent-install-panel";
import { AgentPromptAskAction } from "./agent-prompt-ask-action";
import { createSetupSkillUrl } from "./agent-skill-button";
import { DialogContent } from "./localized-dialog-content";
import { ConfirmActionDialog } from "./primitives";
import { useWorkspacePermissionLevel } from "./split-submit-button";

export interface AgentPromptsManagement {
  customPrompts: CustomAgentPrompts;
  canSave: boolean;
  saving: boolean;
  save: (prompts: CustomAgentPrompts) => Promise<void>;
}

/** Select exactly the preview's text — what a textarea's own select-all used to do. */
const selectPreviewText = (node: HTMLElement) => {
  window.getSelection()?.selectAllChildren(node);
};

const readBuiltInsExpanded = (): boolean => {
  try {
    return window.localStorage.getItem(BUILT_IN_PROMPTS_EXPANDED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const writeBuiltInsExpanded = (expanded: boolean) => {
  try {
    window.localStorage.setItem(BUILT_IN_PROMPTS_EXPANDED_STORAGE_KEY, expanded ? "1" : "0");
  } catch {
    // Storage unavailable (private mode, quota) — the toggle still works for this session.
  }
};

const EMPTY_SLOT_VALUES: Record<string, string> = {};

/** Every prompt for one node/scope opens with the same target line. */
const fixedTargetOf = (...lists: NodePrompt[][]): string | undefined =>
  lists.flat().find((prompt) => prompt.target)?.target;

/**
 * The 📍 card above the prompt list: where the agent should work, in full, and
 * one button that copies just that (with the connection check). What most
 * people came for — the scenarios below are for when they want a ready task.
 */
function LocatorCard({ locator, onCopy }: { locator: AgentLocator; onCopy: () => void }) {
  const messages = useCoreI18n();
  return (
    <div
      className="flex shrink-0 items-start gap-2.5 rounded-md bg-muted/40 px-3 py-2"
      data-testid="agent-prompts-locator-card"
    >
      <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p
          className="line-clamp-2 break-words text-foreground text-sm leading-snug"
          title={locator.target}
        >
          {locator.target}
        </p>
        <p className="mt-0.5 text-muted-foreground text-xs">
          {messages.agentPrompts.locatorCardHint}
        </p>
      </div>
      <Button
        aria-label={messages.agentPrompts.copyLocator}
        className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
        data-testid="agent-prompts-copy-locator"
        onClick={onCopy}
        size="sm"
        title={messages.agentPrompts.locatorCardTitle}
        type="button"
      >
        <MapPin aria-hidden />
        {messages.agentPrompts.copyLocator}
      </Button>
    </div>
  );
}

/** Inline control for one fill-in blank in the preview. */
function SlotControl({
  slot,
  value,
  onChange,
}: {
  slot: PromptSlot;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  const className =
    "mx-0.5 inline-block max-w-full rounded border border-border bg-background px-1 py-0 align-baseline font-medium text-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  if (slot.options.length > 0) {
    return (
      <select
        aria-label={slot.name}
        className={className}
        data-slot={slot.name}
        onChange={(event) => onChange(event.target.value)}
        value={value || slot.defaultValue}
      >
        {slot.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={slot.name}
      className={cn(className, "w-40")}
      data-slot={slot.name}
      onChange={(event) => onChange(event.target.value)}
      placeholder={slot.defaultValue}
      type="text"
      value={value ?? ""}
    />
  );
}

/** A task segment with its blanks rendered as controls, in place. */
function renderTemplateText(
  text: string,
  values: Record<string, string>,
  onChange: (name: string, value: string) => void,
): ReactNode {
  const parts = parsePromptTemplate(text);
  if (!parts.some((part) => part.kind === "slot")) return text;
  return parts.map((part, index) =>
    part.kind === "text" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and never reordered
      <Fragment key={index}>{part.text}</Fragment>
    ) : (
      <SlotControl
        // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and never reordered
        key={index}
        onChange={(value) => onChange(part.slot.name, value)}
        slot={part.slot}
        value={values[part.slot.name]}
      />
    ),
  );
}

/** The distinct fill-in blanks of the task segment(s). */
const slotsOf = (segments: PromptSegment[]): PromptSlot[] => {
  const seen = new Map<string, PromptSlot>();
  for (const segment of segments) {
    if (segment.kind !== "task") continue;
    for (const part of parsePromptTemplate(segment.text)) {
      if (part.kind === "slot" && !seen.has(part.slot.name)) seen.set(part.slot.name, part.slot);
    }
  }
  return [...seen.values()];
};

/** What the folded "Included: …" line names, in the order the text has it. */
const includedParts = (
  segments: PromptSegment[],
  active: NodePrompt | undefined,
  messages: ReturnType<typeof useCoreI18n>,
): string[] => {
  const parts: string[] = [];
  if (segments.some((segment) => segment.kind === "footer")) {
    if (active?.intent !== "read-only") parts.push(messages.agentPrompts.footerPartMergePolicy);
    parts.push(messages.agentPrompts.footerPartReplyLanguage);
  }
  if (segments.some((segment) => segment.kind === "connection")) {
    parts.push(messages.agentPrompts.footerPartConnectionCheck);
  }
  return parts;
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
  locator: locatorProp,
  recents,
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
  /**
   * What the "Copy locator" card at the top copies. Defaults to the prompts'
   * shared target line, which every prompt for one node/scope opens with.
   */
  locator?: AgentLocator;
  /** Where "Recently used" is remembered. Omit to not remember anything. */
  recents?: RecentPromptsContext;
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
  // Fill-in blanks, per prompt so switching back keeps what was chosen.
  const [slotValues, setSlotValues] = useState<Record<string, Record<string, string>>>({});
  // "Show full prompt" / "Included: …" are reading preferences, not per-prompt
  // state: whoever opened them once wants to keep reading prompts that way.
  const [fullPromptOpen, setFullPromptOpen] = useState(false);
  const [footerOpen, setFooterOpen] = useState(false);
  const recentsStorageKey = recents ? recentPromptsStorageKey(recents) : null;
  // Read once per mount, after hydration. Writes go to storage only: a list
  // that re-sorted itself under the cursor right after a copy would be worse
  // than one that remembers next time.
  const [recentKeys, setRecentKeys] = useState<string[]>([]);
  useEffect(() => {
    setRecentKeys(recentsStorageKey ? readRecentPromptKeys(recentsStorageKey) : []);
  }, [recentsStorageKey]);
  const rememberUse = (key: string) => {
    if (!recentsStorageKey) return;
    writeRecentPromptKeys(
      recentsStorageKey,
      pushRecentPromptKey(readRecentPromptKeys(recentsStorageKey), key),
    );
  };
  const copyAttemptRef = useRef(0);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const snippetRef = useRef<HTMLDivElement>(null);
  // The live browser origin, read after mount — never a host's SSR placeholder.
  const [origin, setOrigin] = useState<string>();
  useEffect(() => setOrigin(window.location.origin), []);

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
  // Every node-scope prompt carries the same target line; the editor shows it
  // read-only above the draft, since authors no longer place it themselves.
  const fixedTarget = scenarios.find((prompt) => prompt.target)?.target;
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
  const { recent: recentPrompts, sections: listSections } = useMemo(
    () => partitionRecentPrompts(sections, recentKeys),
    [sections, recentKeys],
  );
  const active =
    (selected
      ? [...recentPrompts, ...flattenPromptSections(listSections)].find(
          (prompt) => prompt.key === selected,
        )
      : undefined) ??
    recentPrompts[0] ??
    resolveActivePrompt(listSections, selected);

  const agentIntegration = agentIntegrationProp ?? agentIntegrationFromContext;
  const { copyLocator } = useCopyLocator(agentIntegrationProp);
  const locatorTarget = locatorProp?.target ?? fixedTargetOf(scenarios, capabilities);
  const locator: AgentLocator | undefined =
    locatorProp ?? (locatorTarget ? { target: locatorTarget, exampleKind: "other" } : undefined);
  const activeSlotValues = (active && slotValues[active.key]) || EMPTY_SLOT_VALUES;
  // The body exactly as it will leave: the person's blanks filled in.
  const activeBody = active?.bodyTemplate
    ? fillPromptSlots(active.bodyTemplate, activeSlotValues)
    : active?.body;
  const edition = agentIntegration?.edition;
  // A stray targetSpaceId from a host must never leak into Desktop guidance —
  // same guard `AgentInstallPanel` applies to the same field.
  const targetSpaceId = edition === "cloud" ? agentIntegration?.targetSpaceId : undefined;

  /**
   * The prompt as previewed — and, joined, the bytes that actually leave: body
   * plus the connection check, so what the user reads is what the agent gets.
   *
   * There is no fallback to the host's `defaultOrigin`: that value is an SSR
   * placeholder (see `AgentInstallPanel`, which rebuilds for the same reason),
   * and a placeholder dev URL reaching a real agent is exactly the failure the
   * rebuild exists to prevent. Until the origin is known there is simply no
   * connection segment.
   */
  const segments = useMemo(
    () =>
      active && activeBody !== undefined
        ? renderPromptSegments({
            body: activeBody,
            connectionCheck: messages.agentPrompts.connectionCheck,
            footer: active.footer,
            fmt,
            leadIn: messages.agentPrompts.connectionCheckLeadIn,
            // `editionConfirmed` is true because a dashboard node is as authoritative
            // as an entry point gets: we know which edition the user is looking at,
            // so the guide should not stop to ask them again.
            setupUrl:
              edition && origin
                ? createSetupSkillUrl(origin, edition, true, targetSpaceId)
                : undefined,
            target: active.target,
            targetSpaceId,
          })
        : [],
    [active, activeBody, edition, messages, origin, targetSpaceId],
  );
  // The same split of the UNFILLED body, so the preview can render each blank
  // as a control in place. Identical to `segments` when there are no blanks.
  const templateSegments = useMemo(
    () =>
      active?.bodyTemplate
        ? renderPromptSegments({
            body: active.bodyTemplate,
            connectionCheck: messages.agentPrompts.connectionCheck,
            footer: active.footer,
            fmt,
            leadIn: messages.agentPrompts.connectionCheckLeadIn,
            setupUrl:
              edition && origin
                ? createSetupSkillUrl(origin, edition, true, targetSpaceId)
                : undefined,
            target: active.target,
            targetSpaceId,
          })
        : segments,
    [active, edition, messages, origin, segments, targetSpaceId],
  );
  const dispatchText = joinPromptSegments(segments);
  const promptEnvelope = useMemo<AgentPromptEnvelope | undefined>(() => {
    if (!active?.nodeTarget || !origin || !edition) return undefined;
    // Cloud tunnels forward into another edition/origin without trusted source attribution.
    // Keep their existing full-text handoff instead of staging a context the local host rejects.
    if (edition === "cloud" && targetSpaceId?.startsWith("tnl_")) return undefined;
    const result = AgentPromptEnvelopeSchema.safeParse({
      version: 1,
      kind: "busabase-agent-prompt",
      scenario: { id: active.key, title: active.label },
      target: active.nodeTarget,
      source: { origin, edition, ...(targetSpaceId ? { spaceId: targetSpaceId } : {}) },
      segments,
    });
    return result.success ? result.data : undefined;
  }, [active, origin, edition, targetSpaceId, segments]);

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
      await copyAgentPromptSnapshot({ text: dispatchText, envelope: promptEnvelope });
      if (copyAttemptRef.current !== attempt) return;
      rememberUse(active.key);
      setCopied(true);
      copyResetTimeoutRef.current = window.setTimeout(() => {
        if (copyAttemptRef.current === attempt) setCopied(false);
        copyResetTimeoutRef.current = null;
      }, 1800);
    } catch {
      if (copyAttemptRef.current !== attempt) return;
      setCopied(false);
      setCopyError(true);
      // Everything that would have been copied must be on screen to copy by
      // hand: open the full prompt and its footer, then select it (below).
      setFullPromptOpen(true);
      setFooterOpen(true);
    }
  };

  // Hand the user a ready selection to copy by hand once the full preview is
  // rendered (it may have been folded behind the outcome a moment ago). A
  // layout effect, so focus lands in the same commit that shows the error.
  useLayoutEffect(() => {
    if (!copyError) return;
    const snippet = snippetRef.current;
    if (snippet) {
      snippet.focus();
      selectPreviewText(snippet);
    }
  }, [copyError]);

  const beginCreate = () => {
    setEditor({ mode: "create", label: "", body: "", intent: "change" });
    setSaveAttempted(false);
    setSaveError(null);
  };

  const beginEdit = (prompt: CustomPromptDef) => {
    setEditor({
      mode: "edit",
      original: prompt,
      label: iStringParse(prompt.label, locale),
      // The target line is fixed now; a draft from before that still opens
      // with the `{target}` placeholder line shows without it.
      body: stripTargetPlaceholderLines(iStringParse(prompt.body, locale)),
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
      <div className={cn("flex min-h-0 flex-col gap-2 sm:h-full", compact && "sm:h-auto")}>
        {locator ? (
          <LocatorCard locator={locator} onCopy={() => void copyLocator(locator)} />
        ) : null}
        <PromptPanel
          active={active}
          askAgentSlot={
            askAgent && canAskAgent ? (
              <AgentPromptAskAction
                onHandedOff={onHandedOff}
                onSent={() => {
                  if (active) rememberUse(active.key);
                }}
                orpc={askAgent.orpc}
                promptText={active ? dispatchText : undefined}
                promptEnvelope={promptEnvelope}
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
          sections={listSections}
          recentPrompts={recentPrompts}
          segments={copyError ? segments : templateSegments}
          slotValues={activeSlotValues}
          onSlotChange={(name, value) => {
            if (!active) return;
            setSlotValues((current) => ({
              ...current,
              [active.key]: { ...current[active.key], [name]: value },
            }));
          }}
          fullPromptOpen={fullPromptOpen}
          onFullPromptOpenChange={setFullPromptOpen}
          footerOpen={footerOpen}
          onFooterOpenChange={setFooterOpen}
          snippetRef={snippetRef}
        />
      </div>

      <CustomPromptDialog
        editor={editor}
        error={saveError}
        fixedTarget={fixedTarget}
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
  segments,
  snippetRef,
  recentPrompts,
  slotValues,
  onSlotChange,
  fullPromptOpen,
  onFullPromptOpenChange,
  footerOpen,
  onFooterOpenChange,
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
  /** The active prompt, split the way `renderPromptSegments` assembles it. */
  segments: PromptSegment[];
  snippetRef: RefObject<HTMLDivElement | null>;
  /** Shown first, under "Recently used"; already removed from `sections`. */
  recentPrompts: NodePrompt[];
  slotValues: Record<string, string>;
  onSlotChange: (name: string, value: string) => void;
  fullPromptOpen: boolean;
  onFullPromptOpenChange: (open: boolean) => void;
  footerOpen: boolean;
  onFooterOpenChange: (open: boolean) => void;
}) {
  const messages = useCoreI18n();
  const builtInsId = useId();
  const fullPromptId = useId();

  const {
    custom: customSections,
    builtIn: builtInSections,
    collapsible,
  } = splitBuiltInSections(sections);
  // Read after mount, not in the initializer: the server has no localStorage,
  // and a first render that disagrees with SSR is a hydration mismatch.
  const [builtInsExpanded, setBuiltInsExpanded] = useState(false);
  useEffect(() => setBuiltInsExpanded(readBuiltInsExpanded()), []);
  const builtInCount = flattenPromptSections(builtInSections).length;
  const activeIsBuiltIn =
    active !== undefined &&
    builtInSections.some((section) => section.items.some((prompt) => prompt.key === active.key));
  // A selected built-in is never hidden — the preview on the right must always
  // have its row on the left.
  const builtInsOpen = !collapsible || builtInsExpanded || activeIsBuiltIn;
  const visibleSections = builtInsOpen ? sections : customSections;

  const toggleBuiltIns = () => {
    const next = !builtInsOpen;
    setBuiltInsExpanded(next);
    writeBuiltInsExpanded(next);
    // Collapsing over the selected built-in would leave the preview orphaned;
    // hand the selection back to the first custom prompt instead.
    if (!next && activeIsBuiltIn) {
      const firstCustom = flattenPromptSections(customSections)[0];
      if (firstCustom) onSelect(firstCustom.key);
    }
  };

  // Flat, ordered list of prompt keys backing arrow-key navigation — the
  // sections above are a purely visual grouping, so a prompt's neighbor for
  // ArrowUp/ArrowDown purposes crosses section boundaries the same way Tab
  // would if every button were reachable in document order. Folded built-ins
  // are not reachable, so they drop out of the order too.
  const orderedKeys = useMemo(
    () => [
      ...recentPrompts.map((prompt) => prompt.key),
      ...flattenPromptSections(visibleSections).map((prompt) => prompt.key),
    ],
    [recentPrompts, visibleSections],
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

  const renderSection = (section: PromptSection) => {
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
                <TooltipContent side="top">{messages.agentPrompts.newCustomPrompt}</TooltipContent>
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
                title={prompt.outcome ?? prompt.label}
                type="button"
              >
                {prompt.label}
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className={cn(
        "grid min-h-0 gap-3 sm:flex-1 sm:grid-cols-[minmax(0,19.5rem)_minmax(0,1fr)]",
        compact && "gap-2 sm:flex-none sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]",
      )}
    >
      <div
        className={cn(
          "max-h-[28vh] overflow-y-auto rounded-md border p-1 sm:max-h-full",
          compact && "max-h-[20vh] sm:h-80 sm:max-h-none",
        )}
      >
        {recentPrompts.length > 0
          ? renderSection({
              name: messages.agentPrompts.recentlyUsed,
              source: "built-in-scenario",
              items: recentPrompts,
            })
          : null}
        {collapsible ? (
          <>
            {customSections.map(renderSection)}
            <button
              aria-controls={builtInsId}
              aria-expanded={builtInsOpen}
              className="mt-1 flex min-h-8 w-full items-center gap-1 rounded px-2 pt-2 pb-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="agent-prompts-built-ins-toggle"
              onClick={toggleBuiltIns}
              type="button"
            >
              <ChevronRight
                aria-hidden
                className={cn(
                  "size-3.5 shrink-0 transition-transform",
                  builtInsOpen && "rotate-90",
                )}
              />
              <span>
                {messages.agentPrompts.builtInPrompts} · {builtInCount}
              </span>
            </button>
            {builtInsOpen ? (
              <div className="pl-2" id={builtInsId}>
                {builtInSections.map(renderSection)}
              </div>
            ) : null}
          </>
        ) : (
          sections.map(renderSection)
        )}
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
        {/* Outcome first: what the person gets back, in one sentence, with
            any fill-in blanks right under it. The prompt text itself is one
            click away — it is what gets copied, but rarely what someone needs
            to read to decide. Prompts without an outcome (capabilities,
            custom prompts) show their full text directly. */}
        {active?.outcome ? (
          <div
            className={cn(
              "space-y-2 px-3 pt-3",
              fullPromptOpen ? "pb-1" : "min-h-0 flex-1 overflow-y-auto pb-3",
            )}
            data-testid="agent-prompts-outcome"
          >
            <p className="text-foreground text-sm leading-relaxed">{active.outcome}</p>
            {!fullPromptOpen && slotsOf(segments).length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground text-xs">
                {slotsOf(segments).map((slot) => (
                  <span className="inline-flex items-center gap-1" key={slot.name}>
                    {slot.name}
                    <SlotControl
                      onChange={(value) => onSlotChange(slot.name, value)}
                      slot={slot}
                      value={slotValues[slot.name]}
                    />
                  </span>
                ))}
              </div>
            ) : null}
            <button
              aria-controls={fullPromptId}
              aria-expanded={fullPromptOpen}
              className="inline-flex items-center gap-1 rounded text-muted-foreground text-xs hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="agent-prompts-full-prompt-toggle"
              onClick={() => onFullPromptOpenChange(!fullPromptOpen)}
              type="button"
            >
              <ChevronRight
                aria-hidden
                className={cn("size-3.5 transition-transform", fullPromptOpen && "rotate-90")}
              />
              {fullPromptOpen
                ? messages.agentPrompts.hideFullPrompt
                : messages.agentPrompts.showFullPrompt}
            </button>
          </div>
        ) : null}
        {/* Everything that will be copied: the target line and the task at
            reading weight; merge/reply policy and the
            connection check folded into one "Included: …" line. One <p> per
            segment, folded or not, so a hand-made selection keeps the
            paragraph breaks and the DOM always holds the full text. */}
        <div
          aria-label={active?.label}
          aria-multiline="true"
          aria-readonly="true"
          className={cn(
            "min-h-[18vh] w-full flex-1 space-y-3 overflow-y-auto p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:min-h-0",
            active?.outcome && !fullPromptOpen && "hidden",
          )}
          data-testid="agent-prompts-preview"
          id={fullPromptId}
          ref={snippetRef}
          // A div's Ctrl/Cmd+A selects the whole page; keep it inside the prompt.
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
              event.preventDefault();
              selectPreviewText(event.currentTarget);
            }
          }}
          role="textbox"
          tabIndex={0}
        >
          {/* Not rendered while folded behind the outcome: the outcome row
              already carries the blanks, and one control per blank is enough. */}
          {active?.outcome && !fullPromptOpen
            ? null
            : segments
                .filter((segment) => segment.kind === "target" || segment.kind === "task")
                .map((segment, index) => (
                  <p
                    className={cn(
                      "whitespace-pre-wrap break-words",
                      segment.kind === "task"
                        ? "text-foreground text-sm leading-relaxed"
                        : "text-muted-foreground text-xs leading-relaxed",
                    )}
                    data-segment={segment.kind}
                    key={`${segment.kind}-${index}`}
                  >
                    {segment.kind === "task"
                      ? renderTemplateText(segment.text, slotValues, onSlotChange)
                      : segment.text}
                  </p>
                ))}
          {(!active?.outcome || fullPromptOpen) &&
          segments.some((segment) => segment.kind === "footer" || segment.kind === "connection") ? (
            <details
              className="group/included"
              data-testid="agent-prompts-included"
              onToggle={(event) => onFooterOpenChange(event.currentTarget.open)}
              open={footerOpen}
            >
              <summary className="flex cursor-pointer list-none select-none items-center gap-1 text-muted-foreground text-xs hover:text-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden
                  className="size-3.5 shrink-0 transition-transform group-open/included:rotate-90"
                />
                {fmt(messages.agentPrompts.footerIncluded, {
                  parts: includedParts(segments, active, messages).join(" · "),
                })}
              </summary>
              <div className="mt-2 space-y-3">
                {segments
                  .filter((segment) => segment.kind === "footer" || segment.kind === "connection")
                  .map((segment, index) => (
                    <p
                      className={cn(
                        "whitespace-pre-wrap break-words text-muted-foreground text-xs leading-relaxed",
                        segment.kind === "connection" && "border-t border-dashed pt-3",
                      )}
                      data-segment={segment.kind}
                      key={`${segment.kind}-${index}`}
                    >
                      {segment.text}
                    </p>
                  ))}
              </div>
            </details>
          ) : null}
        </div>
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
  fixedTarget,
  onOpenChange,
  onChange,
  onSave,
  saving,
  validation,
  saveAttempted,
  error,
}: {
  editor: EditorState | null;
  /** The node's target line, which every prompt opens with and authors cannot edit. */
  fixedTarget?: string;
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
            {fixedTarget ? (
              <div
                className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs"
                data-testid="agent-prompt-fixed-target"
              >
                <p className="font-medium text-muted-foreground">
                  {messages.agentPrompts.fixedTargetLabel}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words font-mono text-foreground/80 leading-relaxed">
                  {fixedTarget}
                </p>
              </div>
            ) : null}
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
