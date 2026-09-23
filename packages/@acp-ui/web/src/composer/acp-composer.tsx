"use client";

import type { AcpAttachment, AcpAvailableCommand } from "@acp-ui/core/reduce";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "kui/ai-elements/attachments";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "kui/ai-elements/prompt-input";
import { PaperclipIcon } from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

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
}

export interface AcpComposerLabels {
  attachFile: string;
  removeAttachment: string;
  submitPrompt: string;
  stopPrompt: string;
  fileTooLarge: (limit: number) => string;
  tooManyFiles: (count: number) => string;
  attachmentFailed: string;
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

export interface AcpComposerProps {
  /** Called with the trimmed text, and any attachments, once the user submits. */
  onSend: (text: string, attachments?: AcpAttachment[]) => void;
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
  /** The host's UI copy; omitted to keep the existing English defaults. */
  labels?: Partial<AcpComposerLabels>;
  /** Per-session ACP commands, updated dynamically by `available_commands_update`. */
  availableCommands?: readonly AcpAvailableCommand[];
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
 * Opens the file picker directly — no dropdown menu, since attach is this
 * composer's only built-in action. Also carries `footerControls`: both sit in
 * the same `PromptInputTools` group so `PromptInputFooter`'s `justify-between`
 * keeps them together on the left, with submit alone on the right, instead of
 * spreading three items across the row.
 */
function AttachButton({
  disabled,
  footerControls,
  label,
}: {
  disabled: boolean;
  footerControls?: ReactNode;
  label?: string;
}) {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputTools>
      <button
        aria-label={label ?? "Attach a file"}
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled}
        onClick={() => attachments.openFileDialog()}
        type="button"
      >
        <PaperclipIcon className="size-4" />
      </button>
      {footerControls}
    </PromptInputTools>
  );
}

/**
 * What's staged before send — cleared by `PromptInput` itself once `onSubmit`
 * accepts.
 *
 * Split by kind rather than rendered as one list, because kui's `grid`
 * variant deliberately drops `AttachmentInfo`: a thumbnail identifies an
 * image on its own, but a document rendered that way is a nameless file icon,
 * and two attached PDFs would be indistinguishable. Documents therefore use
 * the `inline` variant, which keeps the filename visible.
 *
 * `w-full` is load-bearing. `PromptInputFooter` renders with
 * `data-align="block-end"`, which switches kui's `InputGroup` to
 * `flex-col` — and it is `items-center`, so in a column that centres every
 * child horizontally. A width-less wrapper therefore shrinks to its content
 * and floats in the middle of the composer instead of sitting above the
 * textarea. (The previous single `grid` strip escaped this only because that
 * variant carries its own `ml-auto w-fit`.)
 */
function StagedAttachments({ removeLabel }: { removeLabel?: string }) {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;

  const images = attachments.files.filter((file) => (file.mediaType ?? "").startsWith("image/"));
  const rest = attachments.files.filter((file) => !(file.mediaType ?? "").startsWith("image/"));

  return (
    <div className="w-full space-y-2 px-3 pt-2">
      {images.length > 0 ? (
        <Attachments variant="grid">
          {images.map((file) => (
            <Attachment data={file} key={file.id} onRemove={() => attachments.remove(file.id)}>
              <AttachmentPreview />
              <AttachmentRemove label={removeLabel} />
            </Attachment>
          ))}
        </Attachments>
      ) : null}
      {rest.length > 0 ? (
        <Attachments variant="inline">
          {rest.map((file) => (
            <Attachment data={file} key={file.id} onRemove={() => attachments.remove(file.id)}>
              <AttachmentPreview />
              <AttachmentInfo className="max-w-40" />
              <AttachmentRemove label={removeLabel} />
            </Attachment>
          ))}
        </Attachments>
      ) : null}
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
  labels,
  availableCommands = [],
}: AcpComposerProps) {
  const [attachError, setAttachError] = useState<string | null>(null);
  // The field is uncontrolled (kui's `PromptInput` reads it out of the form on
  // submit and resets the form afterwards), so an insertion is a DOM write, not
  // a state update. There is no React state to keep in sync — which is also why
  // this cannot be done from outside the composer without reaching through it.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const appliedDraftId = useRef<string | null>(null);
  const commandImeComposingRef = useRef(false);
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const [activeCommandName, setActiveCommandName] = useState<string | null>(null);
  const commandListId = useId();
  const filteredCommands = useMemo(() => {
    if (commandQuery === null) return [];
    const query = commandQuery.toLowerCase();
    return availableCommands.filter(
      (command) =>
        command.name.toLowerCase().includes(query) ||
        command.description.toLowerCase().includes(query),
    );
  }, [availableCommands, commandQuery]);
  const showCommandPalette = commandQuery !== null && filteredCommands.length > 0;
  const activeCommand =
    filteredCommands.find((command) => command.name === activeCommandName) ?? filteredCommands[0];
  const activeCommandIndex = activeCommand ? filteredCommands.indexOf(activeCommand) : -1;
  const commandOptionId = (command: AcpAvailableCommand) =>
    `${commandListId}-option-${encodeURIComponent(command.name)}`;

  useEffect(() => {
    const field = textareaRef.current;
    if (!draft || !field || appliedDraftId.current === draft.id) return;
    appliedDraftId.current = draft.id;
    field.value = mergeDraft(field.value, draft.text);
    field.focus();
    // Caret at the end: the insertion is a starting point to edit, and landing
    // the cursor anywhere else would make the user press End before typing.
    field.setSelectionRange(field.value.length, field.value.length);
    onDraftApplied?.(draft.id);
  }, [draft, onDraftApplied]);

  const handleSubmit = (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = message.text.trim();
    const attachments = toAttachments(message.files);
    if ((!text && attachments.length === 0) || disabled) return;
    setAttachError(null);
    onSend(text, attachments.length > 0 ? attachments : undefined);
  };

  const applyCommand = (command: AcpAvailableCommand) => {
    const field = textareaRef.current;
    if (!field) return;
    field.value = insertCommand(field.value, command);
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    setCommandQuery(null);
  };

  const handleTextareaChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setCommandQuery(getCommandQuery(event.currentTarget.value));
    setActiveCommandName(null);
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || commandImeComposingRef.current) return;
    if (event.nativeEvent.keyCode === 229) {
      event.preventDefault();
      return;
    }
    if (!showCommandPalette || !activeCommand) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveCommandName(
        filteredCommands[(activeCommandIndex + 1) % filteredCommands.length].name,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveCommandName(
        filteredCommands[
          (activeCommandIndex - 1 + filteredCommands.length) % filteredCommands.length
        ].name,
      );
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      applyCommand(activeCommand);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setCommandQuery(null);
    }
  };

  // `disabled` is usually true DURING a send (both hosts fold `sending` into
  // it), which would otherwise make a freshly-shown stop button unclickable
  // the instant it appears. Carve out exactly that one case.
  const canStop = sending && Boolean(onStop);
  const submitDisabled = disabled && !canStop;

  return (
    <PromptInput
      className={className}
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
      {headerControls ? <PromptInputHeader>{headerControls}</PromptInputHeader> : null}
      <StagedAttachments removeLabel={labels?.removeAttachment} />
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
              className="absolute bottom-full left-3 z-10 mb-2 max-h-56 w-[min(28rem,calc(100%-1.5rem))] overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
              id={commandListId}
              role="listbox"
            >
              {filteredCommands.map((command, index) => (
                <button
                  aria-selected={index === activeCommandIndex}
                  className={`flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${
                    index === activeCommandIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/70"
                  }`}
                  id={commandOptionId(command)}
                  key={command.name}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyCommand(command)}
                  onMouseEnter={() => setActiveCommandName(command.name)}
                  role="option"
                  type="button"
                >
                  <span className="shrink-0 font-medium">/{command.name}</span>
                  <span className="min-w-0 text-muted-foreground">
                    {command.description}
                    {command.input?.hint ? ` - ${command.input.hint}` : ""}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <PromptInputTextarea
            aria-activedescendant={
              showCommandPalette && activeCommand ? commandOptionId(activeCommand) : undefined
            }
            aria-autocomplete="list"
            aria-controls={showCommandPalette ? commandListId : undefined}
            disabled={disabled}
            onChange={handleTextareaChange}
            onCompositionEndCapture={() => {
              commandImeComposingRef.current = false;
            }}
            onCompositionStartCapture={() => {
              commandImeComposingRef.current = true;
            }}
            onKeyDown={handleTextareaKeyDown}
            placeholder={placeholder}
            ref={textareaRef}
          />
        </div>
      </PromptInputBody>
      <PromptInputFooter>
        <AttachButton
          disabled={disabled}
          footerControls={footerControls}
          label={labels?.attachFile}
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
