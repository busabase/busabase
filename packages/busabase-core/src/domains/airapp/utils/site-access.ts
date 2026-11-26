import { ORPCError } from "@orpc/client";
import type { AirAppSiteStateVO } from "busabase-contract/domains/airapp/contract";

export type SiteAccessDenial = "space-vault-manage" | "forbidden" | "unauthorized";

export class AirAppSiteAccessError extends Error {
  constructor(readonly denial: SiteAccessDenial) {
    super("Website access is unavailable for the current account.");
  }
}

/** Permission refusals are stable; provider/network errors remain recoverable. */
export function readSiteAccessDenial(error: unknown): SiteAccessDenial | null {
  if (error instanceof AirAppSiteAccessError) return error.denial;
  if (!(error instanceof ORPCError)) return null;
  if (error.code === "UNAUTHORIZED") return "unauthorized";
  if (error.code !== "FORBIDDEN") return null;
  const data = error.data;
  const reason = data && typeof data === "object" && "reason" in data ? data.reason : null;
  if (reason === "AIRAPP_ENGINE_PLAN_REQUIRED" || reason === "AIRAPP_SITE_PUBLISH_PLAN_REQUIRED")
    return null;
  return reason === "SPACE_VAULT_MANAGE_REQUIRED" ? "space-vault-manage" : "forbidden";
}

export const siteDeploymentDenial = (
  state: AirAppSiteStateVO | undefined,
): SiteAccessDenial | null =>
  state?.environmentDeploymentLock?.reason === "SPACE_VAULT_MANAGE_REQUIRED"
    ? "space-vault-manage"
    : null;

/** A prepared preview can be reused without resolving or uploading Vault values. */
export const sitePreviewDeploymentDenial = (
  state: AirAppSiteStateVO | undefined,
): SiteAccessDenial | null =>
  !state?.previewUrl || !state.previewVersion || state.previewStale || state.previewEnvironmentStale
    ? siteDeploymentDenial(state)
    : null;

export function siteAccessMessage(
  copy: { manageRequired: string; forbidden: string; unauthorized: string },
  denial: SiteAccessDenial,
): string {
  return denial === "space-vault-manage" ? copy.manageRequired : copy[denial];
}
