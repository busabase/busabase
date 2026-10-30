import type { AcpBlock, AcpBlockContext, AcpLifecycleEvent, AcpTurnBlock } from "./types";

/** Derive context from the recorded timeline, never the wall clock. */
export function currentContext(blocks: readonly AcpBlock[]): AcpBlockContext {
  const turn = [...blocks].reverse().find((block) => block.kind === "turn");
  if (turn?.kind !== "turn" || turn.status !== "running") return {};
  const step = [...blocks]
    .reverse()
    .find((block) => block.kind === "step" && block.turnId === turn.id);
  return {
    turnId: turn.id,
    ...(step?.kind === "step" && !step.endedAt ? { stepId: step.id } : {}),
  };
}

function statusOf(reason: string | undefined): AcpTurnBlock["status"] {
  if (reason === "cancelled") return "cancelled";
  if (reason === "error" || reason === "failed") return "failed";
  if (reason === "interrupted" || reason === "disconnected") return "interrupted";
  if (reason === "refusal") return "refused";
  if (reason === "max_tokens" || reason === "max_turn_requests") return "limited";
  return "completed";
}

export function reduceLifecycle(blocks: readonly AcpBlock[], event: AcpLifecycleEvent): AcpBlock[] {
  if (event.version !== 1) return blocks as AcpBlock[];
  const index = blocks.findIndex((block) => block.kind === "turn" && block.id === event.turnId);
  if (event.type === "turn_started") {
    // A replayed start cannot reopen a turn whose terminal event was already seen.
    if (index !== -1) return blocks as AcpBlock[];
    return [
      ...blocks,
      {
        kind: "turn",
        id: event.turnId,
        startedAt: event.at,
        status: "running",
        ...(event.label ? { label: event.label } : {}),
      },
    ];
  }
  if (event.type === "turn_finished") {
    const previous = index === -1 ? undefined : (blocks[index] as AcpTurnBlock);
    const turn: AcpTurnBlock = {
      kind: "turn",
      id: event.turnId,
      startedAt: previous?.startedAt ?? event.at,
      ...previous,
      endedAt: event.at,
      status: statusOf(event.stopReason),
      ...(event.stopReason ? { stopReason: event.stopReason } : {}),
      ...(event.usage ? { usage: event.usage } : {}),
    };
    const result =
      index === -1 ? [...blocks, turn] : blocks.map((block, i) => (i === index ? turn : block));
    return result.map((block) => {
      if (!("turnId" in block) || block.turnId !== event.turnId) return block;
      if (block.kind === "step" && !block.endedAt) return { ...block, endedAt: event.at };
      if (block.kind === "permission" && block.resolution === "pending")
        return { ...block, resolution: "cancelled" };
      if (block.kind === "input_request" && block.resolution === "pending")
        return { ...block, resolution: { action: "cancel" }, error: undefined };
      if (
        block.kind === "tool_call" &&
        (block.status === "pending" || block.status === "in_progress")
      ) {
        return {
          ...block,
          status: "failed",
          outcome: event.stopReason === "cancelled" ? "cancelled" : "interrupted",
        };
      }
      return block;
    });
  }
  if (event.type === "step_started" || event.type === "step_finished") {
    if (!event.stepId) return blocks as AcpBlock[];
    const stepIndex = blocks.findIndex(
      (block) =>
        block.kind === "step" && block.id === event.stepId && block.turnId === event.turnId,
    );
    if (event.type === "step_started") {
      if (stepIndex !== -1) return blocks as AcpBlock[];
      return [
        ...blocks,
        {
          kind: "step",
          id: event.stepId,
          turnId: event.turnId,
          startedAt: event.at,
          ...(event.label ? { label: event.label } : {}),
        },
      ];
    }
    if (stepIndex === -1) return blocks as AcpBlock[];
    return blocks.map((block, i) =>
      i === stepIndex ? { ...block, endedAt: event.at } : block,
    ) as AcpBlock[];
  }
  if (event.type === "resource_update" && event.resource) {
    const resource = event.resource;
    const resourceIndex = blocks.findIndex(
      (block) => block.kind === "resource" && block.id === resource.id,
    );
    const next: AcpBlock = { kind: "resource", id: resource.id, turnId: event.turnId, resource };
    return resourceIndex === -1
      ? [...blocks, next]
      : blocks.map((block, i) => (i === resourceIndex ? next : block));
  }
  if (event.type === "job_update" && event.job) {
    const job = event.job;
    const jobIndex = blocks.findIndex((block) => block.kind === "job" && block.id === job.id);
    const next: AcpBlock = { kind: "job", id: job.id, turnId: event.turnId, job };
    return jobIndex === -1
      ? [...blocks, next]
      : blocks.map((block, i) => (i === jobIndex ? next : block));
  }
  return blocks as AcpBlock[];
}
