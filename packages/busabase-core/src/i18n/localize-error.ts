import { fmt } from "./fmt";
import type { CoreI18nMessages } from "./messages";

const NODE_PERMISSION_MESSAGE_MAP = {
  read: "requiresReadOnNode",
  changeRequest: "requiresChangeRequestOnNode",
  write: "requiresWriteOnNode",
  manage: "requiresManageOnNode",
} as const satisfies Record<string, keyof CoreI18nMessages["permissions"]>;

const NODE_PERMISSION_PATTERN = /^Requires (read|changeRequest|write|manage) access on this node$/;

const FORM_ALREADY_EXISTS_MESSAGE =
  "A form already exists for this node. Use the update form endpoint instead.";
// Thrown (CONFLICT) by `nodeSlugConflict` in logic/node-slug.ts.
const NODE_SLUG_CONFLICT_PATTERN =
  /^The \S+ slug "([^"]*)" is already used in this workspace\. Choose a different slug\.$/;
const INVALID_FORM_CURSOR_MESSAGE = "The form cursor is invalid.";
// Thrown (BAD_REQUEST) when proposing or merging the deletion of a Base's last view.
const LAST_VIEW_DELETE_MESSAGE =
  "A Base must keep at least one view. Create another view before deleting this one.";
const MAX_PRESENTED_ERROR_LENGTH = 300;

export function localizeCoreErrorMessage(messages: CoreI18nMessages, message: string): string {
  if (message === FORM_ALREADY_EXISTS_MESSAGE) {
    return messages.form.alreadyExists;
  }
  if (message === INVALID_FORM_CURSOR_MESSAGE) {
    return messages.form.invalidCursor;
  }
  if (message === LAST_VIEW_DELETE_MESSAGE) {
    return messages.base.lastViewCannotBeDeleted;
  }
  const slugConflictMatch = NODE_SLUG_CONFLICT_PATTERN.exec(message);
  if (slugConflictMatch) {
    return fmt(messages.common.slugTaken, { slug: slugConflictMatch[1] ?? "" });
  }
  const permissionMatch = NODE_PERMISSION_PATTERN.exec(message);
  if (permissionMatch) {
    const level = permissionMatch[1] as keyof typeof NODE_PERMISSION_MESSAGE_MAP;
    return messages.permissions[NODE_PERMISSION_MESSAGE_MAP[level]];
  }

  return message;
}

const truncateErrorMessage = (message: string): string => {
  const characters = Array.from(message.trim());
  if (characters.length <= MAX_PRESENTED_ERROR_LENGTH) return characters.join("");
  return `${characters.slice(0, MAX_PRESENTED_ERROR_LENGTH - 1).join("")}…`;
};

/** Show the server's reason in every locale, bounded so diagnostics cannot overwhelm the UI. */
export function presentCoreError(
  messages: CoreI18nMessages,
  _locale: string,
  error: unknown,
  fallback: string,
): string {
  if (!(error instanceof Error)) return fallback;
  const localized = localizeCoreErrorMessage(messages, error.message);
  return truncateErrorMessage(localized) || fallback;
}
