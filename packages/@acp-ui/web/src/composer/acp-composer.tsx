"use client";

import type { AcpAttachment } from "@acp-ui/core/reduce";
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
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "kui/ai-elements/prompt-input";
import { PaperclipIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

/** 10 MB. Base64 inflates a payload by a third, and the whole prompt travels
 * as one JSON-RPC message — a cap here is what keeps a stray 200 MB video
 * from becoming a 270 MB request body nothing downstream is sized for. */
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 10;

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
  /** Per-file ceiling in bytes. Defaults to 10 MB. */
  maxFileSize?: number;
  /** How many files may be staged at once. Defaults to 10. */
  maxFiles?: number;
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

/** Opens the file picker directly — no dropdown menu, since attach is this composer's only action. */
function AttachButton({ disabled }: { disabled: boolean }) {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputTools>
      <button
        aria-label="Attach a file"
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled}
        onClick={() => attachments.openFileDialog()}
        type="button"
      >
        <PaperclipIcon className="size-4" />
      </button>
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
 */
function StagedAttachments() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;

  const images = attachments.files.filter((file) => (file.mediaType ?? "").startsWith("image/"));
  const rest = attachments.files.filter((file) => !(file.mediaType ?? "").startsWith("image/"));

  return (
    <div className="space-y-2 px-3 pt-2">
      {images.length > 0 ? (
        <Attachments variant="grid">
          {images.map((file) => (
            <Attachment data={file} key={file.id} onRemove={() => attachments.remove(file.id)}>
              <AttachmentPreview />
              <AttachmentRemove />
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
              <AttachmentRemove />
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
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  maxFiles = DEFAULT_MAX_FILES,
}: AcpComposerProps) {
  const [attachError, setAttachError] = useState<string | null>(null);

  const handleSubmit = (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = message.text.trim();
    const attachments = toAttachments(message.files);
    if ((!text && attachments.length === 0) || disabled) return;
    setAttachError(null);
    onSend(text, attachments.length > 0 ? attachments : undefined);
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
      onError={(err) =>
        setAttachError(
          err.code === "max_file_size"
            ? `That file is too large. The limit is ${Math.round(maxFileSize / (1024 * 1024))} MB.`
            : err.code === "max_files"
              ? `You can attach at most ${maxFiles} files at a time.`
              : err.message,
        )
      }
      onSubmit={handleSubmit}
    >
      <StagedAttachments />
      {attachError ? (
        <p className="px-3 pt-2 text-destructive text-xs" role="alert">
          {attachError}
        </p>
      ) : null}
      <PromptInputBody>
        <PromptInputTextarea disabled={disabled} placeholder={placeholder} />
      </PromptInputBody>
      <PromptInputFooter>
        <AttachButton disabled={disabled} />
        <PromptInputSubmit
          disabled={submitDisabled}
          onStop={onStop}
          status={sending ? "streaming" : undefined}
        />
      </PromptInputFooter>
    </PromptInput>
  );
}
