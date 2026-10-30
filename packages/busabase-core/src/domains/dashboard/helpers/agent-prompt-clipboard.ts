import {
  AGENT_PROMPT_CLIPBOARD_MIME,
  type AgentPromptEnvelope,
  AgentPromptEnvelopeSchema,
  joinAgentPromptSegments,
} from "busabase-contract/domains/agents/prompt-context";

export interface AgentPromptCopySnapshot {
  text: string;
  envelope?: AgentPromptEnvelope;
}

/** One synchronous user-gesture copy event writes both formats, with plain-text recovery. */
export async function copyAgentPromptSnapshot(snapshot: AgentPromptCopySnapshot): Promise<void> {
  // Capture immutable strings before a permission-bound asynchronous fallback or a scenario change.
  const text = snapshot.text;
  const envelope = AgentPromptEnvelopeSchema.safeParse(snapshot.envelope);
  const metadata =
    envelope.success && joinAgentPromptSegments(envelope.data.segments) === text
      ? JSON.stringify(envelope.data)
      : undefined;
  const previousFocus = document.activeElement;
  const inputSelection =
    previousFocus instanceof HTMLInputElement || previousFocus instanceof HTMLTextAreaElement
      ? {
          start: previousFocus.selectionStart,
          end: previousFocus.selectionEnd,
          direction: previousFocus.selectionDirection,
        }
      : null;
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : [];
  const temporary = document.createElement("textarea");
  temporary.value = text;
  temporary.readOnly = true;
  temporary.tabIndex = -1;
  temporary.style.cssText = "position:fixed;left:-10000px;top:0;opacity:0";
  let plainWritten = false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    try {
      event.clipboardData.setData("text/plain", text);
      plainWritten = true;
    } catch {
      return;
    }
    if (metadata) {
      try {
        event.clipboardData.setData(AGENT_PROMPT_CLIPBOARD_MIME, metadata);
      } catch {
        /* Plain text remains in this same operation when custom formats are unsupported. */
      }
    }
    event.preventDefault();
  };
  let copied = false;
  try {
    // Stay within the current modal/focus trap. Selecting a body-level control can be intercepted.
    const container =
      previousFocus instanceof HTMLElement ? previousFocus.closest('[role="dialog"]') : null;
    (container ?? document.body).append(temporary);
    temporary.focus({ preventScroll: true });
    temporary.select();
    document.addEventListener("copy", onCopy, { capture: true, once: true });
    copied = document.execCommand("copy") && plainWritten;
  } catch {
    /* execCommand is optional; the full-text async fallback follows below. */
  } finally {
    document.removeEventListener("copy", onCopy, true);
    temporary.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
      if (
        inputSelection &&
        inputSelection.start !== null &&
        inputSelection.end !== null &&
        (previousFocus instanceof HTMLInputElement || previousFocus instanceof HTMLTextAreaElement)
      ) {
        previousFocus.setSelectionRange(
          inputSelection.start,
          inputSelection.end,
          inputSelection.direction ?? undefined,
        );
      }
    }
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
  }
  if (copied) return;
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard copy is unavailable");
  await navigator.clipboard.writeText(text);
}
