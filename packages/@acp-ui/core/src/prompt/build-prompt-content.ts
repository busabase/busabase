import type * as acp from "@agentclientprotocol/sdk";
import type { AcpAttachment } from "../reduce";
import { attachmentText, attachmentToContentBlock } from "./attachment-media";

/**
 * The prompt to send, plus anything the user needs told about it.
 *
 * `notes` exists because silence is the wrong failure mode here. ACP makes
 * `image`, `audio` and `embeddedContext` opt-in capabilities an agent must
 * advertise, so an attachment can be perfectly valid and still be
 * unsendable to *this* agent. Dropping it quietly leaves the user staring at
 * a reply that ignores the PDF they attached with no way to know why. Each
 * note is a plain sentence a host can surface the same way busabase already
 * surfaces its `mcpCapabilities.http` note.
 */
export interface BuiltPrompt {
  prompt: acp.ContentBlock[];
  notes: string[];
}

/**
 * Text + staged attachments → ACP's `PromptRequest.prompt` content-block
 * array, negotiated against what the agent actually said it can accept.
 *
 * ACP's baseline is narrow and explicit: "Baseline agent functionality
 * requires support for `ContentBlock::Text` and `ContentBlock::ResourceLink`.
 * Other variants must be explicitly opted in to." Images, audio and embedded
 * resources are all opt-in, so sending them blind is a protocol violation that
 * happens to work only because the popular agents happen to support them.
 *
 * `capabilities` is what makes this compliant:
 * - `undefined`/`null` → no negotiation available; send everything, which is
 *   this function's historical behaviour and keeps a host that hasn't wired
 *   `initialize` results through working exactly as before.
 * - provided → a capability is supported only if it is explicitly `true`. ACP
 *   says an omitted capability means unsupported, so `{}` correctly gates
 *   everything off.
 *
 * A `file` the agent can't take embedded is not simply discarded when it is
 * textual: its content is appended to the text block instead. Text is a
 * baseline capability every agent supports, and the token cost is the same
 * either way — the file's words are the file's words — so the fallback keeps
 * Markdown, CSV, JSON and source files usable on agents that advertise
 * nothing. Binary files have no such fallback and say so.
 */
export function buildPromptContent(
  text: string,
  attachments: readonly AcpAttachment[] | undefined,
  capabilities?: acp.PromptCapabilities | null,
): BuiltPrompt {
  const negotiated = capabilities != null;
  const supports = (capability: keyof acp.PromptCapabilities) =>
    !negotiated || capabilities?.[capability] === true;

  const blocks: acp.ContentBlock[] = [];
  const inlined: string[] = [];
  const rejectedMedia: string[] = [];
  const rejectedBinary: string[] = [];
  const inlinedNames: string[] = [];

  for (const attachment of attachments ?? []) {
    if (attachment.kind === "image" || attachment.kind === "audio") {
      if (supports(attachment.kind)) {
        blocks.push(attachmentToContentBlock(attachment));
      } else {
        rejectedMedia.push(attachment.kind);
      }
      continue;
    }

    const name = attachment.filename?.trim() || "attachment";
    const asText = attachmentText(attachment.mimeType, attachment.data);

    if (supports("embeddedContext")) {
      blocks.push(attachmentToContentBlock(attachment));
      continue;
    }

    if (asText === null) {
      rejectedBinary.push(name);
    } else {
      inlined.push(
        `--- Attached file: ${name} ---\n${asText}\n--- End of attached file: ${name} ---`,
      );
      inlinedNames.push(name);
    }
  }

  const notes: string[] = [];
  if (rejectedMedia.length > 0) {
    const kinds = [...new Set(rejectedMedia)].sort().join(" or ");
    notes.push(
      `This agent does not accept ${kinds} attachments, so ${rejectedMedia.length === 1 ? "it was" : "they were"} not sent.`,
    );
  }
  if (inlinedNames.length > 0) {
    notes.push(
      `This agent does not accept file attachments, so ${formatList(inlinedNames)} ${inlinedNames.length === 1 ? "was" : "were"} included as plain text instead.`,
    );
  }
  if (rejectedBinary.length > 0) {
    notes.push(
      `This agent does not accept file attachments, and ${formatList(rejectedBinary)} ${rejectedBinary.length === 1 ? "is" : "are"} not text, so ${rejectedBinary.length === 1 ? "it was" : "they were"} not sent.`,
    );
  }

  // The text block stays first and is emitted even when empty: an
  // attachment-only prompt is valid, and both hosts' contracts already
  // guarantee at least one of text/attachments is present.
  const promptText = [text, ...inlined].filter((part) => part.length > 0).join("\n\n");
  return { prompt: [{ type: "text", text: promptText }, ...blocks], notes };
}

function formatList(names: string[]): string {
  if (names.length === 1) return names[0] as string;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
