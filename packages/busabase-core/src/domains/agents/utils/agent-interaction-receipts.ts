import type {
  AgentInputResponse,
  AgentSessionEventVO,
} from "busabase-contract/domains/agents/types";
import { translateAcpExtension } from "./acp-fidelity";

export type AgentInteractionReceipt = "same" | "conflict" | "pending" | "missing";

/** Compare the JSON decision, independently of property insertion order. */
function semanticJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(semanticJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${semanticJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function inputDecision(response: AgentInputResponse): string {
  // Only accept has meaningful content. Omitted content carries no answers.
  return semanticJson(
    response.action === "accept"
      ? { action: response.action, content: response.content ?? {} }
      : { action: response.action },
  );
}

/**
 * A resolved event is an immutable delivery receipt. A replayed request cannot
 * reopen it, and an in-flight/optimistic answering event cannot confirm it.
 */
export function inspectInputReceipt(
  events: readonly AgentSessionEventVO[],
  requestId: string,
  response: AgentInputResponse,
): AgentInteractionReceipt {
  let requested = false;
  let confirmed: string | undefined;
  let inconsistent = false;
  const resolve = (result: AgentInputResponse) => {
    const decision = inputDecision(result);
    if (confirmed !== undefined && confirmed !== decision) inconsistent = true;
    confirmed ??= decision;
  };
  for (const event of events) {
    if (event.kind === "inputRequest" && event.inputRequest?.requestId === requestId) {
      requested = true;
    }
    if (
      event.kind === "inputResolved" &&
      event.inputRequestId === requestId &&
      event.inputResponse
    ) {
      resolve(event.inputResponse);
    }
    for (const update of translateAcpExtension(event.acpExtension)) {
      if (update.type === "input_request" && update.requestId === requestId) requested = true;
      if (update.type === "input_resolved" && update.requestId === requestId) resolve(update);
    }
  }
  if (inconsistent) return "conflict";
  if (confirmed !== undefined) return confirmed === inputDecision(response) ? "same" : "conflict";
  return requested ? "pending" : "missing";
}

export function inspectPermissionReceipt(
  events: readonly AgentSessionEventVO[],
  requestId: string,
  optionId: string,
): AgentInteractionReceipt {
  let requested = false;
  let confirmed: string | undefined;
  let cancelled = false;
  let inconsistent = false;
  const resolve = (selected: string) => {
    if (cancelled || (confirmed !== undefined && confirmed !== selected)) inconsistent = true;
    confirmed ??= selected;
  };
  for (const event of events) {
    if (event.kind === "permissionRequest" && event.permissionRequest?.requestId === requestId) {
      requested = true;
    }
    if (
      event.kind === "permissionResolved" &&
      event.permissionRequestId === requestId &&
      event.permissionOptionId
    ) {
      resolve(event.permissionOptionId);
    }
    for (const update of translateAcpExtension(event.acpExtension)) {
      if (update.type === "permission_request" && update.requestId === requestId) requested = true;
      if (update.type === "permission_resolved" && update.requestId === requestId)
        resolve(update.optionId);
      if (update.type === "permission_cancelled" && update.requestId === requestId) {
        if (confirmed !== undefined) inconsistent = true;
        cancelled = true;
      }
    }
  }
  if (inconsistent || cancelled) return "conflict";
  if (confirmed !== undefined) return confirmed === optionId ? "same" : "conflict";
  return requested ? "pending" : "missing";
}
