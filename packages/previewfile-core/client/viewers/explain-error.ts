import type { Messages } from "../i18n/messages";
import { ViewerError } from "./viewer-error";

/**
 * Why a file could not be shown, in the viewer's language. A viewer's own
 * error names its reason; a failed request is explained by its status; any
 * other text — a library's own wording, like epub.js's "No Section Found" — is
 * a file the viewer could not read, unless the caller knows better
 * (`otherwise`). The original text is kept for the technical details.
 */
export function explainError(
  messages: Messages,
  error: string | Error,
  otherwise: string = messages.errorCorrupted(),
): string {
  if (error instanceof ViewerError) return messages[error.messageKey]();
  const message = typeof error === "string" ? error : error.message;
  // A failed request names its status after a colon: "Failed to fetch file: 404 Not Found".
  // Only that counts — zip.js's "End of central directory not found" is about the file.
  const status = Number(/:\s*(\d{3})\b/.exec(message)?.[1]);
  if (status === 404) return messages.errorNotFound();
  if (status === 403) return messages.errorForbidden();
  // The server answered, so the connection is fine.
  if (status >= 500) return messages.errorServer();
  if (message.includes("timeout")) return messages.errorTimeout();
  if (message.includes("Network") || message.includes("fetch")) return messages.errorNetwork();
  return otherwise;
}
