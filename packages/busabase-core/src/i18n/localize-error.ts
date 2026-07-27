import type { CoreI18nMessages } from "./messages";

const NODE_PERMISSION_MESSAGE_MAP = {
  read: "requiresReadOnNode",
  changeRequest: "requiresChangeRequestOnNode",
  write: "requiresWriteOnNode",
  manage: "requiresManageOnNode",
} as const satisfies Record<string, keyof CoreI18nMessages["permissions"]>;

const NODE_PERMISSION_PATTERN = /^Requires (read|changeRequest|write|manage) access on this node$/;

export function localizeCoreErrorMessage(messages: CoreI18nMessages, message: string): string {
  const permissionMatch = NODE_PERMISSION_PATTERN.exec(message);
  if (permissionMatch) {
    const level = permissionMatch[1] as keyof typeof NODE_PERMISSION_MESSAGE_MAP;
    return messages.permissions[NODE_PERMISSION_MESSAGE_MAP[level]];
  }

  return message;
}
