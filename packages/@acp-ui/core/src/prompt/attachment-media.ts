/**
 * Deciding whether an attachment travels as *text* or as *bytes*.
 *
 * ACP's `EmbeddedResource` carries either `TextResourceContents` (a `text`
 * field) or `BlobResourceContents` (a base64 `blob`), and the protocol says
 * nothing about which to use for a given file — that choice is left to the
 * client. It matters more than it looks: a Markdown file sent as a blob
 * reaches the agent as base64 it has to decode before it can read a word,
 * while the same file sent as text is immediately usable. Getting it wrong
 * costs the user an unusable attachment, not just an inelegant one.
 *
 * The wire shape stays uniform on purpose — `AcpAttachment.data` is ALWAYS
 * base64, for every kind — so the browser never has to guess an encoding and
 * binary payloads can't be corrupted in transit. This module is what turns
 * that uniform payload back into the right ACP shape at the point of send.
 */

import type * as acp from "@agentclientprotocol/sdk";
import type { AcpAttachment } from "../reduce";

/** MIME types that are text despite not living under `text/`. */
const TEXTUAL_APPLICATION_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/xhtml+xml",
  "application/javascript",
  "application/ecmascript",
  "application/typescript",
  "application/sql",
  "application/graphql",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/x-sh",
  "application/x-shellscript",
  "application/x-httpd-php",
  "application/x-latex",
  "application/x-tex",
]);

/** Binary families worth short-circuiting before any byte sniffing. */
const BINARY_PREFIXES = ["image/", "audio/", "video/", "font/"];

/**
 * `true` textual, `false` binary, `undefined` when the MIME type alone can't
 * say. Browsers report `""` for extensions they don't know (very common for
 * source files) and actively *mislabel* some — a `.ts` file is reported as
 * `video/mp2t`, an MPEG transport stream, which is why the caller falls back
 * to sniffing the bytes rather than trusting this answer when it is
 * `undefined` — and why `video/` is NOT treated as a confident `false`.
 */
export function classifyMimeType(mimeType: string): boolean | undefined {
  const type = mimeType.trim().toLowerCase().split(";")[0] ?? "";
  if (type === "") return undefined;
  if (type.startsWith("text/")) return true;
  if (TEXTUAL_APPLICATION_TYPES.has(type)) return true;
  // Structured syntax suffixes are text wherever they appear, which includes
  // `image/svg+xml` — an SVG is markup an agent can read and edit, so it is
  // checked before the `image/` prefix below would call it binary.
  if (type.endsWith("+json") || type.endsWith("+xml")) return true;
  // `video/mp2t` is excluded deliberately: it is what browsers report for
  // `.ts` TypeScript files far more often than for real transport streams.
  if (type === "video/mp2t") return undefined;
  if (BINARY_PREFIXES.some((prefix) => type.startsWith(prefix))) return false;
  if (type === "application/octet-stream") return undefined;
  if (type.startsWith("application/")) return false;
  return undefined;
}

/** Base64 → bytes. `null` when `data` isn't valid base64 at all. */
export function decodeBase64(data: string): Uint8Array | null {
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Bytes → string, but only if they really are text.
 *
 * `fatal: true` makes the decoder reject invalid UTF-8 instead of silently
 * scattering U+FFFD replacement characters through a binary file — which is
 * exactly the failure this guards against, since a PDF decoded that way looks
 * like plausible text right up until the agent tries to use it. A NUL byte is
 * treated as binary regardless: it decodes as valid UTF-8, but no real text
 * file contains one.
 */
export function decodeUtf8Text(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The text of an attachment whose payload is genuinely text, or `null` when it
 * is binary (or undecodable).
 *
 * MIME decides when it is confident; the bytes themselves decide when it is
 * not. Sniffing rather than guessing from the file extension is what makes an
 * extensionless `Dockerfile` or a browser-mislabelled `.ts` land as text
 * without also mistaking a real `.ts` transport stream for one.
 */
export function attachmentText(mimeType: string, data: string): string | null {
  const classified = classifyMimeType(mimeType);
  if (classified === false) return null;
  const bytes = decodeBase64(data);
  if (bytes === null) return null;
  const text = decodeUtf8Text(bytes);
  if (text === null) return null;
  // A confident textual MIME type is trusted even for empty content; an
  // unknown one has only the bytes to go on, and empty bytes say nothing.
  if (classified === undefined && text.length === 0) return null;
  return text;
}

/**
 * The `uri` every embedded resource must carry.
 *
 * ACP requires the field but says nothing about its scheme, and there is no
 * real one to report: the file was uploaded from a browser and exists nowhere
 * the agent can reach. `file:///` was rejected for exactly that reason — it
 * invites an agent to try opening a path that does not exist, turning a
 * working attachment into a confusing "no such file". An opaque
 * `attachment:///` scheme is honest about what this is: a label for content
 * that is already embedded in the message and needs no fetching.
 */
export function attachmentUri(filename: string | undefined): string {
  return `attachment:///${encodeURIComponent(filename?.trim() || "attachment")}`;
}

/**
 * One `AcpAttachment` → the ACP content block that carries it.
 *
 * Shared by the real send path (`buildPromptContent`) and by the local echo a
 * host without a server-side prompt echo renders optimistically, so the
 * message a user sees is built from the same rules as the message the agent
 * receives — rather than the echo hand-rolling a `{ type: attachment.kind }`
 * object that is not a valid content block at all for a `file`.
 */
export function attachmentToContentBlock(attachment: AcpAttachment): acp.ContentBlock {
  if (attachment.kind === "image" || attachment.kind === "audio") {
    return { type: attachment.kind, data: attachment.data, mimeType: attachment.mimeType };
  }
  const uri = attachmentUri(attachment.filename);
  const text = attachmentText(attachment.mimeType, attachment.data);
  return {
    type: "resource",
    resource:
      text === null
        ? { uri, mimeType: attachment.mimeType, blob: attachment.data }
        : { uri, mimeType: attachment.mimeType, text },
  };
}
