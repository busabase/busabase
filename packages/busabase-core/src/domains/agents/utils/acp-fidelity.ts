import type { AcpLifecycleEvent, AcpUiEvent } from "@acp-ui/core/reduce";
import {
  AgentInputRequestVOSchema,
  AgentInputResponseSchema,
  type AgentPermissionRequestVOSchema,
  AgentResourceVOSchema,
  type AgentSessionEventVO,
} from "busabase-contract/domains/agents/types";
import { z } from "zod";

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export function budaMetadata(value: unknown): Record<string, unknown> | undefined {
  return object(object(object(value)?._meta)?.["buda.im"]);
}

/** The upstream cursor belongs to a persisted event, so its commit is the acknowledgement. */
export function upstreamSeqOf(
  event: Pick<AgentSessionEventVO, "acpUpdate" | "acpExtension">,
): number | undefined {
  const source = event.acpUpdate ?? event.acpExtension?.params;
  const seq = budaMetadata(source)?.seq;
  return typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0 ? seq : undefined;
}

export function highestUpstreamSeq(events: readonly AgentSessionEventVO[]): number | undefined {
  let cursor: number | undefined;
  for (const event of events) {
    const seq = upstreamSeqOf(event);
    if (seq !== undefined) cursor = cursor === undefined ? seq : Math.max(cursor, seq);
  }
  return cursor;
}

const lifecycleSchema = z.object({
  version: z.literal(1),
  type: z.enum([
    "turn_started",
    "step_started",
    "step_finished",
    "turn_finished",
    "resource_update",
    "job_update",
  ]),
  turnId: z.string().min(1),
  at: z.string(),
  stepId: z.string().optional(),
  label: z.string().optional(),
  stopReason: z.string().optional(),
  usage: z
    .object({
      inputTokens: z.number().nonnegative().nullish(),
      outputTokens: z.number().nonnegative().nullish(),
      totalTokens: z.number().nonnegative().nullish(),
      cachedReadTokens: z.number().nonnegative().nullish(),
      cachedWriteTokens: z.number().nonnegative().nullish(),
      thoughtTokens: z.number().nonnegative().nullish(),
    })
    .transform((usage) =>
      Object.fromEntries(Object.entries(usage).filter(([, count]) => typeof count === "number")),
    )
    .optional()
    .catch(undefined),
  resource: AgentResourceVOSchema.optional(),
  job: z
    .object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      resourceIds: z.array(z.string()).optional(),
      message: z.string().optional(),
    })
    .optional(),
});

/** Adapt only understood versions; the original envelope remains in the event journal. */
export function translateAcpExtension(
  extension: AgentSessionEventVO["acpExtension"],
): AcpUiEvent[] {
  if (!extension || !["_buda.im/session_event", "_acp-ui/lifecycle"].includes(extension.method))
    return [];
  const event = object(object(extension.params)?.event);
  if (!event) return [];
  if (event.type === "input_request") {
    const parsed = AgentInputRequestVOSchema.safeParse(event);
    return parsed.success ? [{ type: "input_request", ...parsed.data }] : [];
  }
  if (event.type === "input_resolved" && typeof event.requestId === "string") {
    const parsed = AgentInputResponseSchema.safeParse(event);
    return parsed.success
      ? [{ type: "input_resolved", requestId: event.requestId, ...parsed.data }]
      : [];
  }
  if (event.type === "input_answering" && typeof event.requestId === "string") {
    const response = AgentInputResponseSchema.safeParse(event.response);
    return [
      {
        type: "input_answering",
        requestId: event.requestId,
        ...(response.success ? { response: response.data } : {}),
      },
    ];
  }
  if (event.type === "permission_answering" && typeof event.requestId === "string") {
    return [
      {
        type: "permission_answering",
        requestId: event.requestId,
        ...(typeof event.optionId === "string" ? { optionId: event.optionId } : {}),
      },
    ];
  }
  if (
    event.type === "permission_request" &&
    typeof event.requestId === "string" &&
    Array.isArray(event.options)
  ) {
    const options = z
      .array(z.object({ optionId: z.string(), name: z.string(), kind: z.string().optional() }))
      .safeParse(event.options);
    return options.success
      ? [
          {
            type: "permission_request",
            requestId: event.requestId,
            title: typeof event.title === "string" ? event.title : "Tool authorization",
            options: options.data,
          },
        ]
      : [];
  }
  if (
    event.type === "permission_resolved" &&
    typeof event.requestId === "string" &&
    typeof event.optionId === "string"
  ) {
    return [{ type: "permission_resolved", requestId: event.requestId, optionId: event.optionId }];
  }
  if (
    (event.type === "permission_cancelled" ||
      (event.type === "permission_resolved" && event.action === "cancel")) &&
    typeof event.requestId === "string"
  ) {
    return [{ type: "permission_cancelled", requestId: event.requestId }];
  }
  const parsed = lifecycleSchema.safeParse(event);
  return parsed.success ? [{ type: "lifecycle", event: parsed.data as AcpLifecycleEvent }] : [];
}

export function pendingInputOf(events: readonly AgentSessionEventVO[], requestId: string) {
  let request: z.infer<typeof AgentInputRequestVOSchema> | undefined;
  let resolved = false;
  for (const event of events) {
    if (event.inputRequest?.requestId === requestId && !resolved) request = event.inputRequest;
    if (event.inputRequestId === requestId) {
      request = undefined;
      resolved = true;
    }
    for (const translated of translateAcpExtension(event.acpExtension)) {
      if (translated.type === "input_request" && translated.requestId === requestId && !resolved)
        request = translated;
      if (translated.type === "input_resolved" && translated.requestId === requestId) {
        request = undefined;
        resolved = true;
      }
    }
  }
  return request;
}

export function pendingPermissionOf(events: readonly AgentSessionEventVO[], requestId: string) {
  let request: z.infer<typeof AgentPermissionRequestVOSchema> | undefined;
  let resolved = false;
  for (const event of events) {
    if (event.permissionRequest?.requestId === requestId && !resolved)
      request = event.permissionRequest;
    if (event.permissionRequestId === requestId) {
      request = undefined;
      resolved = true;
    }
    for (const translated of translateAcpExtension(event.acpExtension)) {
      if (
        translated.type === "permission_request" &&
        translated.requestId === requestId &&
        !resolved
      )
        request = translated;
      if (translated.type === "permission_resolved" && translated.requestId === requestId) {
        request = undefined;
        resolved = true;
      }
      if (translated.type === "permission_cancelled" && translated.requestId === requestId) {
        request = undefined;
        resolved = true;
      }
    }
  }
  return request;
}
