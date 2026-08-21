"use client";

import type { AcpAttachment } from "@acp-ui/core/reduce";
import {
  Attachment,
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
import type { FormEvent } from "react";

export interface AcpComposerProps {
  /** Called with the trimmed text, and any image/audio attached, once the user submits. */
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
}

/** Only these are representable as `AcpAttachment` — see its doc comment. */
const isAttachableMediaType = (mediaType: string) =>
  mediaType.startsWith("image/") || mediaType.startsWith("audio/");

/**
 * `PromptInputMessage.files[].url` is always a `data:` URL by the time
 * `onSubmit` fires — `PromptInput` converts blob URLs before calling it. This
 * strips the `data:<mime>;base64,` prefix back to the raw payload ACP wants.
 * A file whose type slipped past `accept` (e.g. a drag-drop of something
 * other than image/audio) is dropped here rather than sent malformed —
 * `accept` on `<PromptInput>` keeps the file *dialog* to image/audio, but
 * paste and drag-drop are not filterable that strictly, so this is the real
 * gate.
 */
export function toAttachments(files: PromptInputMessage["files"]): AcpAttachment[] {
  const attachments: AcpAttachment[] = [];
  for (const file of files) {
    if (!isAttachableMediaType(file.mediaType)) continue;
    const commaIndex = file.url.indexOf(",");
    if (!file.url.startsWith("data:") || commaIndex === -1) continue;
    attachments.push({
      kind: file.mediaType.startsWith("audio/") ? "audio" : "image",
      data: file.url.slice(commaIndex + 1),
      mimeType: file.mediaType,
    });
  }
  return attachments;
}

/** Opens the file picker directly — no dropdown menu, since attach is this composer's only action. */
function AttachButton({ disabled }: { disabled: boolean }) {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputTools>
      <button
        aria-label="Attach an image or audio clip"
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

/** What's staged before send — cleared by `PromptInput` itself once `onSubmit` accepts. */
function StagedAttachments() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;
  return (
    <Attachments className="px-3 pt-2" variant="grid">
      {attachments.files.map((file) => (
        <Attachment data={file} key={file.id} onRemove={() => attachments.remove(file.id)}>
          <AttachmentPreview />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  );
}

/**
 * The ACP prompt box, shared by acprouter and busabase.
 *
 * Built on `kui/ai-elements`'s `PromptInput` for the parts worth not
 * hand-rolling twice: IME-safe Enter-to-send (a real gap in both apps' prior
 * hand-rolled textareas — pressing Enter to confirm a Chinese/Japanese IME
 * candidate would have submitted early), Shift+Enter for a newline, a submit
 * button disabled while the field is empty, and attaching images/audio —
 * paste or the picker — with a preview strip before sending.
 */
export function AcpComposer({
  onSend,
  disabled,
  sending = false,
  onStop,
  placeholder,
  className,
}: AcpComposerProps) {
  const handleSubmit = (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = message.text.trim();
    const attachments = toAttachments(message.files);
    if ((!text && attachments.length === 0) || disabled) return;
    onSend(text, attachments.length > 0 ? attachments : undefined);
  };

  // `disabled` is usually true DURING a send (both hosts fold `sending` into
  // it), which would otherwise make a freshly-shown stop button unclickable
  // the instant it appears. Carve out exactly that one case.
  const canStop = sending && Boolean(onStop);
  const submitDisabled = disabled && !canStop;

  return (
    <PromptInput accept="image/*,audio/*" className={className} onSubmit={handleSubmit}>
      <StagedAttachments />
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
