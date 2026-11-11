import "server-only";

import { ORPCError } from "@orpc/server";

/** Explicit, idempotent policy for the dedicated encrypted webhook signing credential. */
export const WEBHOOK_BACKUP_MARKER = "__busabaseBackup";
export const prepareWebhookBackupRow = (row: Record<string, unknown>): Record<string, unknown> => {
  const config = row.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return row;
  const value = config as Record<string, unknown>;
  const existing = value[WEBHOOK_BACKUP_MARKER];
  const marker =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : undefined;
  const reconnect =
    marker?.version === 1 &&
    marker.secretOmitted === true &&
    marker.requiresReconnect === true &&
    typeof marker.sourceEnabled === "boolean";
  if (value.secret === null || value.secret === undefined) {
    return reconnect ? { ...row, enabled: false } : row;
  }
  if (existing !== undefined && !reconnect)
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Webhook configuration uses a reserved backup marker; cannot omit its dedicated secret safely",
    });
  const { secret: _secret, ...nonsecret } = value;
  return {
    ...row,
    enabled: false,
    config: {
      ...nonsecret,
      [WEBHOOK_BACKUP_MARKER]: reconnect
        ? existing
        : {
            version: 1,
            secretOmitted: true,
            requiresReconnect: true,
            sourceEnabled: row.enabled === true,
          },
    },
  };
};

export const webhookNeedsReconnect = (row: Record<string, unknown>): boolean => {
  const config = row.config as Record<string, unknown> | undefined;
  const marker = config?.[WEBHOOK_BACKUP_MARKER] as Record<string, unknown> | undefined;
  return (
    marker?.version === 1 && marker.secretOmitted === true && marker.requiresReconnect === true
  );
};
