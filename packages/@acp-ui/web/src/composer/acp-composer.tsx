"use client";

import type { AcpAttachment, AcpAvailableCommand, AcpResourceContext } from "@acp-ui/core/reduce";
import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "kui/ai-elements/prompt-input";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "kui/dropdown-menu";
import { AppWindowIcon, FileIcon, PaperclipIcon, Wand2 } from "lucide-react";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { AcpContextChip, AcpResourceContextChip } from "./context-chip";

export { AcpContextChip } from "./context-chip";

/** 10 MB. Base64 inflates a payload by a third, and the whole prompt travels
 * as one JSON-RPC message — a cap here is what keeps a stray 200 MB video
 * from becoming a 270 MB request body nothing downstream is sized for. */
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 10;

/**
 * Text a host wants dropped into the draft *without sending it*.
 *
 * `id` is what makes this safe to hand in declaratively: the same `id` is
 * applied at most once, so a re-render (or a parent that keeps passing the same
 * object) cannot re-insert the text. Hand a fresh `id` per user action to
 * insert again.
 */
export interface AcpComposerDraft {
  id: string;
  text: string;
  resourceContext?: AcpResourceContext[];
}

/** A locally staged file. Its object URL belongs to the composer until removal or send. */
export interface AcpComposerAttachment {
  id: string;
  url: string;
  mediaType: string;
  filename?: string;
}

export interface AcpComposerLabels {
  attachFile: string;
  removeAttachment: string;
  submitPrompt: string;
  stopPrompt: string;
  fileTooLarge: (limit: number) => string;
  tooManyFiles: (count: number) => string;
  attachmentFailed: string;
  addMenuTitle: string;
  uploadFilesMenuItem: string;
  chooseSkillMenuItem: string;
  inspectContext: string;
  removeContext: string;
  contextContent: string;
}

/**
 * Merge an insertion into whatever the user already typed.
 *
 * Appending on a fresh line rather than overwriting is the whole point: the
 * draft may hold something the user typed and has not sent, and a feature that
 * silently eats it would be worse than not offering the insertion at all.
 * Exported for its own test — this is the rule, not an implementation detail.
 */
export const mergeDraft = (existing: string, addition: string): string => {
  if (existing.trim() === "") return addition;
  return `${existing.replace(/\s+$/, "")}\n${addition}`;
};

/** A trailing slash token is a command query; slash text in earlier prose is not. */
export const getCommandQuery = (text: string): string | null => {
  const match = text.match(/(?:^|\s)\/([^\s]*)$/);
  return match ? match[1] : null;
};

export const insertCommand = (text: string, command: AcpAvailableCommand): string =>
  text.replace(/(?:^|\s)\/([^\s]*)$/, (match) => {
    const prefix = match.startsWith("/") ? "" : match.slice(0, 1);
    return `${prefix}/${command.name}${command.input ? " " : ""}`;
  });

/**
 * A space/workspace Skill (a `SKILL.md`-backed node) the host offers from the
 * same "/" palette as ACP-advertised commands. Unlike `AcpAvailableCommand`,
 * this is not an ACP protocol type — it is host data (busabase's own
 * filetree nodes), so it lives here rather than in `@acp-ui/core`. `nodeId`
 * is what lets the host turn a pick into a context reference; the composer
 * itself never reads the skill's content.
 */
export interface AcpWorkspaceSkill {
  nodeId: string;
  name: string;
  description: string;
}

/** The slash palette merges two namespaces; each row remembers which one it came from. */
type PaletteItem =
  | { kind: "command"; key: string; command: AcpAvailableCommand }
  | { kind: "skill"; key: string; skill: AcpWorkspaceSkill };

const toPaletteItems = (
  commands: readonly AcpAvailableCommand[],
  skills: readonly AcpWorkspaceSkill[],
): PaletteItem[] => [
  ...commands.map(
    (command): PaletteItem => ({ kind: "command", key: `command:${command.name}`, command }),
  ),
  ...skills.map((skill): PaletteItem => ({ kind: "skill", key: `skill:${skill.nodeId}`, skill })),
];

const paletteItemName = (item: PaletteItem) =>
  item.kind === "command" ? item.command.name : item.skill.name;
const paletteItemDescription = (item: PaletteItem) =>
  item.kind === "command" ? item.command.description : item.skill.description;
const paletteItemHint = (item: PaletteItem) =>
  item.kind === "command" ? item.command.input?.hint : undefined;

export const insertPaletteItem = (text: string, item: PaletteItem): string =>
  item.kind === "command"
    ? insertCommand(text, item.command)
    : text.replace(/(?:^|\s)\/([^\s]*)$/, (match) => {
        const prefix = match.startsWith("/") ? "" : match.slice(0, 1);
        return `${prefix}/${item.skill.name} `;
      });

export interface AcpComposerProps {
  /** Called with the trimmed text, and any attachments, once the user submits. */
  onSend: (
    text: string,
    attachments?: AcpAttachment[],
    resourceContext?: AcpResourceContext[],
  ) => void | Promise<void>;
  /** Decode and validate host metadata during an explicit paste. Undefined/empty keeps native paste. */
  decodePaste?: (clipboardData: DataTransfer) => AcpResourceContext[] | undefined;
  /** Host limits for the complete staged context list. Rejected handoffs retain full text. */
  validateResourceContext?: (contexts: readonly AcpResourceContext[]) => boolean;
  /** Current staged context, including removal and successful submission. */
  onResourceContextChange?: (contexts: AcpResourceContext[]) => void;
  /** Allows a host-owned context reference to be submitted without a caption. */
  hasAdditionalContent?: boolean;
  /** Host-computed: acprouter derives this from session lifecycle, busabase
   * from its richer session status (busy / waiting_permission / ended /
   * failed). The composer stays dumb on purpose — see @acp-ui/web's README. */
  disabled: boolean;
  /** Drives the submit button's spinner. */
  sending?: boolean;
  /**
   * Shows a stop button in place of submit while `sending` is true, and
   * keeps it clickable even though `disabled` is normally also true during a
   * send (both hosts compute `disabled` from `sending`, among other things).
   * Omit to leave the submit button simply disabled while sending, as before
   * this existed — a host with no way to cancel a turn in flight (there is
   * none among the current two) does not have to fake one.
   */
  onStop?: () => void;
  placeholder?: string;
  className?: string;
  /**
   * Prefill, never send. busabase's "Ask Agent" hands the chosen prompt in this
   * way so the moment before sending — the one where people actually narrow the
   * ask ("…but only the last week") — still belongs to the user. An agent turn
   * costs money and minutes; an accidental click must be recoverable by
   * clearing a textbox, not by cancelling a running session.
   */
  draft?: AcpComposerDraft | null;
  /** Fired once `draft` has landed in the field, so the host can retire it. */
  onDraftApplied?: (id: string) => void;
  /** Per-file ceiling in bytes. Defaults to 10 MB. */
  maxFileSize?: number;
  /** How many files may be staged at once. Defaults to 10. */
  maxFiles?: number;
  /**
   * A host-provided control rendered in the footer, between the attach
   * button and submit — e.g. busabase's per-session model picker. This
   * composer is shared with acprouter, which has no such control and simply
   * never passes one; the footer's layout (and every existing host) is
   * unaffected when this is omitted.
   */
  footerControls?: ReactNode;
  /**
   * A host-provided control rendered above the textarea, inside the same
   * bordered surface — e.g. busabase's removable node-context chip. This
   * composer is shared with acprouter, which has no such control and simply
   * never passes one; omitted by default so no host renders an empty header
   * row.
   */
  headerControls?: ReactNode;
  /** Host-owned preview around the file's content; the remove control stays separate. */
  renderAttachment?: (file: AcpComposerAttachment, content: ReactNode) => ReactNode;
  /** The host's UI copy; omitted to keep the existing English defaults. */
  labels?: Partial<AcpComposerLabels>;
  /** Per-session ACP commands, updated dynamically by `available_commands_update`. */
  availableCommands?: readonly AcpAvailableCommand[];
  /**
   * Space/workspace Skills the host offers from the same "/" palette as
   * `availableCommands`, listed under their own section when both are
   * present. busabase passes the current space's `skill` nodes here; the
   * composer never reads their content — it only inserts `/<name>` and, via
   * `onWorkspaceSkillSelected`, lets the host decide what picking one means
   * (busabase adds it as a context reference, resolved lazily at send time).
   */
  workspaceSkills?: readonly AcpWorkspaceSkill[];
  /** Fired when the user picks a `workspaceSkills` entry from the palette. */
  onWorkspaceSkillSelected?: (skill: AcpWorkspaceSkill) => void;
  addContextAction?: {
    label: string;
    added: boolean;
    onSelect: () => void;
  };
}

/** Images and audio have dedicated ACP content blocks; everything else is a file. */
const isMediaType = (mediaType: string) =>
  mediaType.startsWith("image/") || mediaType.startsWith("audio/");

/**
 * `PromptInputMessage.files[].url` is always a `data:` URL by the time
 * `onSubmit` fires — `PromptInput` converts blob URLs before calling it. This
 * strips the `data:<mime>;base64,` prefix back to the raw payload ACP wants.
 *
 * Every file maps to some `AcpAttachment`: images and audio to their own ACP
 * content blocks, and anything else — a PDF, a spreadsheet, a Markdown note,
 * an extensionless `Dockerfile` — to `kind: "file"`, which becomes an ACP
 * embedded resource at send time. Nothing is silently discarded here any
 * more; what an individual agent can actually accept is negotiated
 * server-side against its advertised `promptCapabilities`, which is the only
 * place that answer is known.
 */
export function toAttachments(files: PromptInputMessage["files"]): AcpAttachment[] {
  const attachments: AcpAttachment[] = [];
  for (const file of files) {
    const commaIndex = file.url.indexOf(",");
    if (!file.url.startsWith("data:") || commaIndex === -1) continue;
    const data = file.url.slice(commaIndex + 1);
    const mediaType = file.mediaType || "application/octet-stream";
    if (isMediaType(mediaType)) {
      attachments.push({
        kind: mediaType.startsWith("audio/") ? "audio" : "image",
        data,
        mimeType: mediaType,
      });
    } else {
      attachments.push({
        kind: "file",
        data,
        mimeType: mediaType,
        ...(file.filename ? { filename: file.filename } : {}),
      });
    }
  }
  return attachments;
}

/**
 * A "+" dropdown — upload (the same file picker this composer always had),
 * an entry that adds the host's current node as context when the host offers
 * one, and, when the session has advertised any ACP commands, an entry that
 * opens the exact same "/" command palette a typed slash would. Also carries
 * `footerControls`: both sit in the same `PromptInputTools` group so
 * `PromptInputFooter`'s `justify-between` keeps them together on the left,
 * with submit alone on the right, instead of spreading three items across
 * the row.
 */
function AttachButton({
  disabled,
  footerControls,
  labels,
  hasCommands,
  onChooseSkill,
  addContextAction,
}: {
  disabled: boolean;
  footerControls?: ReactNode;
  labels?: Partial<AcpComposerLabels>;
  hasCommands: boolean;
  onChooseSkill: () => void;
  addContextAction?: AcpComposerProps["addContextAction"];
}) {
  const attachments = usePromptInputAttachments();
  const [menuOpen, setMenuOpen] = useState(false);
  const chooseSkillOnClose = useRef(false);

  const handleUpload = (event: Event) => {
    attachments.openFileDialog();
    event.preventDefault();
    setMenuOpen(false);
  };

  const handleAddContext = (event: Event) => {
    event.preventDefault();
    setMenuOpen(false);
    addContextAction?.onSelect();
  };

  const handleChooseSkill = (event: Event) => {
    event.preventDefault();
    chooseSkillOnClose.current = true;
    setMenuOpen(false);
  };

  return (
    <PromptInputTools>
      <PromptInputActionMenu onOpenChange={setMenuOpen} open={menuOpen}>
        <PromptInputActionMenuTrigger
          aria-label={labels?.attachFile ?? "Attach a file"}
          className="size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          disabled={disabled}
        />
        <PromptInputActionMenuContent
          className="w-56"
          onCloseAutoFocus={(event) => {
            if (!chooseSkillOnClose.current) return;
            chooseSkillOnClose.current = false;
            event.preventDefault();
            onChooseSkill();
          }}
        >
          <DropdownMenuLabel className="text-muted-foreground text-xs">
            {labels?.addMenuTitle ?? "Add to message"}
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={handleUpload}>
            <PaperclipIcon className="mr-2 size-4" />
            {labels?.uploadFilesMenuItem ?? "Upload files"}
          </DropdownMenuItem>
          {addContextAction ? (
            <DropdownMenuItem disabled={addContextAction.added} onSelect={handleAddContext}>
              <AppWindowIcon className="mr-2 size-4" />
              {addContextAction.label}
            </DropdownMenuItem>
          ) : null}
          {hasCommands ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleChooseSkill}>
                <Wand2 className="mr-2 size-4" />
                {labels?.chooseSkillMenuItem ?? "Choose a skill"}
              </DropdownMenuItem>
            </>
          ) : null}
        </PromptInputActionMenuContent>
      </PromptInputActionMenu>
      {footerControls}
    </PromptInputTools>
  );
}

function StagedAttachments({
  removeLabel,
  children,
  renderAttachment,
}: {
  removeLabel?: string;
  children?: ReactNode;
  renderAttachment?: AcpComposerProps["renderAttachment"];
}) {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0 && !children) return null;

  return (
    <div className="flex w-full flex-wrap items-center gap-2 px-3 pt-3">
      {children}
      {attachments.files.map((file) => {
        const content = (
          <>
            {(file.mediaType ?? "").startsWith("image/") && file.url ? (
              <img
                alt={file.filename || "Image"}
                className="size-4 shrink-0 rounded-sm object-cover"
                src={file.url}
              />
            ) : (
              <FileIcon className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 max-w-40 truncate font-medium">
              {file.filename || "Attachment"}
            </span>
          </>
        );
        return (
          <AcpContextChip
            key={file.id}
            onRemove={() => attachments.remove(file.id)}
            removeLabel={removeLabel}
            title={file.filename || "Attachment"}
          >
            {renderAttachment ? renderAttachment(file, content) : content}
          </AcpContextChip>
        );
      })}
    </div>
  );
}

/**
 * The ACP prompt box, shared by acprouter and busabase.
 *
 * Built on `kui/ai-elements`'s `PromptInput` for the parts worth not
 * hand-rolling twice: IME-safe Enter-to-send (a real gap in both apps' prior
 * hand-rolled textareas — pressing Enter to confirm a Chinese/Japanese IME
 * candidate would have submitted early), Shift+Enter for a newline, a submit
 * button disabled while the field is empty, and attaching files — picker,
 * paste or drag-drop — with a preview strip before sending.
 *
 * No `accept` is passed on purpose. kui's own filter compares `accept`
 * patterns against a file's MIME type only, so an extension pattern like
 * `.md` would pass the OS file dialog and then be rejected by kui itself,
 * and a source file the browser reports as `""` would be rejected by any
 * MIME-based allowlist at all. Since what a given agent can accept is
 * negotiated server-side from its `promptCapabilities` anyway, the composer
 * takes the file and lets that single decision point apply.
 */
export function AcpComposer({
  onSend,
  disabled,
  sending = false,
  onStop,
  placeholder,
  className,
  draft,
  onDraftApplied,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  maxFiles = DEFAULT_MAX_FILES,
  footerControls,
  headerControls,
  renderAttachment,
  labels,
  availableCommands = [],
  workspaceSkills = [],
  onWorkspaceSkillSelected,
  hasAdditionalContent = false,
  addContextAction,
  decodePaste,
  validateResourceContext,
  onResourceContextChange,
}: AcpComposerProps) {
  const [attachError, setAttachError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  // The field is uncontrolled (kui's `PromptInput` reads it out of the form on
  // submit and resets the form afterwards), so an insertion is a DOM write, not
  // a state update. There is no React state to keep in sync — which is also why
  // this cannot be done from outside the composer without reaching through it.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const appliedDraftIds = useRef(new Set<string>());
  const [resourceContext, setResourceContext] = useState<AcpResourceContext[]>([]);
  const resourceContextRef = useRef<AcpResourceContext[]>([]);
  const changeContexts = useCallback((contexts: AcpResourceContext[]) => {
    resourceContextRef.current = contexts;
    setResourceContext(contexts);
  }, []);
  const acceptsContexts = useCallback(
    (contexts: readonly AcpResourceContext[]) => {
      try {
        return validateResourceContext?.(contexts) ?? true;
      } catch {
        return false;
      }
    },
    [validateResourceContext],
  );
  useEffect(() => {
    onResourceContextChange?.(resourceContext);
  }, [resourceContext, onResourceContextChange]);
  const commandImeComposingRef = useRef(false);
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const [activeItemKey, setActiveItemKey] = useState<string | null>(null);
  const commandListId = useId();
  const paletteItems = useMemo(
    () => toPaletteItems(availableCommands, workspaceSkills),
    [availableCommands, workspaceSkills],
  );
  const filteredItems = useMemo(() => {
    if (commandQuery === null) return [];
    const query = commandQuery.toLowerCase();
    return paletteItems.filter(
      (item) =>
        paletteItemName(item).toLowerCase().includes(query) ||
        paletteItemDescription(item).toLowerCase().includes(query),
    );
  }, [paletteItems, commandQuery]);
  const showCommandPalette = commandQuery !== null && filteredItems.length > 0;
  const activeItem = filteredItems.find((item) => item.key === activeItemKey) ?? filteredItems[0];
  const activeItemIndex = activeItem ? filteredItems.indexOf(activeItem) : -1;
  const commandOptionId = (item: PaletteItem) =>
    `${commandListId}-option-${encodeURIComponent(item.key)}`;

  useEffect(() => {
    const field = textareaRef.current;
    if (!draft || !field || appliedDraftIds.current.has(draft.id)) return;
    appliedDraftIds.current.add(draft.id);
    if (draft.text) field.value = mergeDraft(field.value, draft.text);
    if (draft.resourceContext?.length) {
      const combined = [...resourceContextRef.current, ...draft.resourceContext];
      if (acceptsContexts(combined)) {
        changeContexts(combined);
      } else {
        // A handoff has no native paste to fall back to. Keep its complete
        // snapshot visible as ordinary text without disturbing staged content.
        field.value = mergeDraft(
          field.value,
          draft.resourceContext.map((context) => context.text).join("\n\n"),
        );
      }
    }
    field.focus();
    // Caret at the end: the insertion is a starting point to edit, and landing
    // the cursor anywhere else would make the user press End before typing.
    field.setSelectionRange(field.value.length, field.value.length);
    onDraftApplied?.(draft.id);
  }, [draft, onDraftApplied, changeContexts, acceptsContexts]);

  useEffect(() => {
    const inputGroup = textareaRef.current?.closest<HTMLElement>("[data-slot=input-group]");
    if (!inputGroup) return;
    // KUI intentionally clips its generic input group, but this composer owns
    // a popup that opens outside those bounds. KUI exposes no class slot for
    // the group, so opt this instance out without changing the shared library.
    const previousOverflow = inputGroup.style.getPropertyValue("overflow");
    const previousPriority = inputGroup.style.getPropertyPriority("overflow");
    inputGroup.style.setProperty("overflow", "visible", "important");
    return () => {
      if (previousOverflow) {
        inputGroup.style.setProperty("overflow", previousOverflow, previousPriority);
      } else {
        inputGroup.style.removeProperty("overflow");
      }
    };
  }, []);

  const handleSubmit = (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = message.text.trim();
    const attachments = toAttachments(message.files);
    const contexts = resourceContextRef.current;
    if (
      (!text && attachments.length === 0 && contexts.length === 0 && !hasAdditionalContent) ||
      disabled ||
      submittingRef.current
    ) {
      return;
    }
    setAttachError(null);
    // PromptInput clears the uncontrolled field without dispatching a change.
    // Its slash palette must leave with the submitted draft as well.
    setCommandQuery(null);
    setActiveItemKey(null);
    const submittedField = textareaRef.current;
    const restoreDraft = () => {
      // PromptInput resets an uncontrolled field before calling us. A failed
      // acceptance must restore it, while preserving anything inserted later.
      if (!submittedField || textareaRef.current !== submittedField) return;
      submittedField.value = submittedField.value
        ? mergeDraft(message.text, submittedField.value)
        : message.text;
      setCommandQuery(getCommandQuery(submittedField.value));
      setActiveItemKey(null);
    };
    try {
      const files = attachments.length > 0 ? attachments : undefined;
      // Keep the original two-argument call contract for all existing hosts.
      const result = contexts.length ? onSend(text, files, contexts) : onSend(text, files);
      const accepted = () => {
        const submitted = new Set(contexts);
        changeContexts(resourceContextRef.current.filter((context) => !submitted.has(context)));
      };
      if (result instanceof Promise) {
        submittingRef.current = true;
        setSubmitting(true);
        return result
          .then(accepted)
          .catch((error: unknown) => {
            restoreDraft();
            throw error;
          })
          .finally(() => {
            submittingRef.current = false;
            setSubmitting(false);
          });
      }
      accepted();
    } catch (error) {
      restoreDraft();
      throw error;
    }
  };

  const applyPaletteItem = (item: PaletteItem) => {
    const field = textareaRef.current;
    if (!field) return;
    field.value = insertPaletteItem(field.value, item);
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    setCommandQuery(null);
    if (item.kind === "skill") onWorkspaceSkillSelected?.(item.skill);
  };

  const handleChooseSkill = () => {
    const field = textareaRef.current;
    if (!field) return;
    if (getCommandQuery(field.value) === null) {
      field.value = `${field.value}${field.value && !/\s$/.test(field.value) ? " " : ""}/`;
    }
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    setCommandQuery(getCommandQuery(field.value));
    setActiveItemKey(null);
  };

  const handleTextareaChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setCommandQuery(getCommandQuery(event.currentTarget.value));
    setActiveItemKey(null);
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || commandImeComposingRef.current) return;
    if (event.nativeEvent.keyCode === 229) {
      event.preventDefault();
      return;
    }
    if (!showCommandPalette || !activeItem) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveItemKey(filteredItems[(activeItemIndex + 1) % filteredItems.length].key);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveItemKey(
        filteredItems[(activeItemIndex - 1 + filteredItems.length) % filteredItems.length].key,
      );
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      applyPaletteItem(activeItem);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setCommandQuery(null);
    }
  };

  // `disabled` is usually true DURING a send (both hosts fold `sending` into
  // it), which would otherwise make a freshly-shown stop button unclickable
  // the instant it appears. Carve out exactly that one case.
  const canStop = sending && Boolean(onStop);
  const inputDisabled = disabled || submitting;
  const submitDisabled = inputDisabled && !canStop;
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (inputDisabled || !decodePaste) return;
    let contexts: AcpResourceContext[] | undefined;
    try {
      contexts = decodePaste(event.clipboardData);
    } catch {
      return; // Invalid metadata must never prevent ordinary text/file paste.
    }
    if (!contexts?.length) return;
    const combined = [...resourceContextRef.current, ...contexts];
    if (!acceptsContexts(combined)) return;
    changeContexts(combined);
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <PromptInput
      // The palette opens upward over the transcript. Raise the whole composer
      // into that stacking order; a z-index on the child alone cannot escape a
      // sibling transcript's stacking context and leaves visible options
      // unclickable in the real Operate panel.
      className={["relative z-20", className].filter(Boolean).join(" ")}
      maxFileSize={maxFileSize}
      maxFiles={maxFiles}
      // Without this the hidden `<input type="file">` has no `multiple`
      // attribute, so the OS picker — the paperclip button, i.e. the primary
      // affordance — accepts exactly one file, while drag-drop and paste
      // happily add several. `maxFiles` promised up to ten and the picker
      // silently allowed one. Caught by driving the real browser; jsdom tests
      // upload a single file and never exercise the picker's own limit.
      multiple={maxFiles !== 1}
      onError={(err) =>
        setAttachError(
          err.code === "max_file_size"
            ? (labels?.fileTooLarge?.(Math.round(maxFileSize / (1024 * 1024))) ??
                `That file is too large. The limit is ${Math.round(maxFileSize / (1024 * 1024))} MB.`)
            : err.code === "max_files"
              ? (labels?.tooManyFiles?.(maxFiles) ??
                `You can attach at most ${maxFiles} files at a time.`)
              : (labels?.attachmentFailed ?? err.message),
        )
      }
      onSubmit={handleSubmit}
    >
      <StagedAttachments removeLabel={labels?.removeAttachment} renderAttachment={renderAttachment}>
        {headerControls || resourceContext.length > 0 ? (
          <>
            {headerControls}
            {resourceContext.map((context, index) => (
              <AcpResourceContextChip
                key={`${context.id}:${index}`}
                context={context}
                disabled={inputDisabled}
                inspectLabel={labels?.inspectContext}
                removeLabel={labels?.removeContext}
                contentLabel={labels?.contextContent}
                onRemove={() =>
                  changeContexts(
                    resourceContextRef.current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
              />
            ))}
          </>
        ) : undefined}
      </StagedAttachments>
      {attachError ? (
        // `w-full` for the same reason as `StagedAttachments` — a direct
        // `InputGroup` child without it is centred, not left-aligned.
        <p className="w-full px-3 pt-2 text-destructive text-xs" role="alert">
          {attachError}
        </p>
      ) : null}
      <PromptInputBody>
        <div className="relative w-full">
          {showCommandPalette ? (
            <div
              aria-label="Available commands"
              className="absolute bottom-full left-0 z-10 mb-2 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
              id={commandListId}
              role="listbox"
            >
              {filteredItems.map((item, index) => (
                <button
                  aria-selected={index === activeItemIndex}
                  className={`flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${
                    index === activeItemIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/70"
                  }`}
                  id={commandOptionId(item)}
                  key={item.key}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyPaletteItem(item)}
                  onMouseEnter={() => setActiveItemKey(item.key)}
                  role="option"
                  type="button"
                >
                  {item.kind === "skill" ? (
                    <Wand2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  ) : null}
                  <span className="shrink-0 font-medium">/{paletteItemName(item)}</span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {paletteItemDescription(item)}
                    {paletteItemHint(item) ? ` - ${paletteItemHint(item)}` : ""}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <PromptInputTextarea
            aria-activedescendant={
              showCommandPalette && activeItem ? commandOptionId(activeItem) : undefined
            }
            aria-autocomplete="list"
            aria-controls={showCommandPalette ? commandListId : undefined}
            disabled={inputDisabled}
            onChange={handleTextareaChange}
            onCompositionEndCapture={() => {
              commandImeComposingRef.current = false;
            }}
            onCompositionStartCapture={() => {
              commandImeComposingRef.current = true;
            }}
            onKeyDown={handleTextareaKeyDown}
            onPasteCapture={handlePaste}
            placeholder={placeholder}
            ref={textareaRef}
          />
        </div>
      </PromptInputBody>
      <PromptInputFooter>
        <AttachButton
          disabled={inputDisabled}
          footerControls={footerControls}
          labels={labels}
          hasCommands={availableCommands.length > 0 || workspaceSkills.length > 0}
          onChooseSkill={handleChooseSkill}
          addContextAction={addContextAction}
        />
        <PromptInputSubmit
          aria-label={sending ? (labels?.stopPrompt ?? "Stop") : (labels?.submitPrompt ?? "Submit")}
          disabled={submitDisabled}
          className={
            sending
              ? "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              : undefined
          }
          onStop={onStop}
          status={sending ? "streaming" : undefined}
          variant={sending ? "outline" : "default"}
        />
      </PromptInputFooter>
    </PromptInput>
  );
}
