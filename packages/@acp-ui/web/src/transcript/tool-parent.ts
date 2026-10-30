import type { AcpToolCallBlock } from "@acp-ui/core/reduce";

export function parentToolCallId(block: AcpToolCallBlock): string | undefined {
  if (block.parentToolCallId !== undefined)
    return block.parentToolCallId && block.parentToolCallId !== block.id
      ? block.parentToolCallId
      : undefined;
  const scoped = block._meta?.["buda.im"];
  const candidates = [
    block._meta?.parentToolCallId,
    block._meta?.["bunny-agent/parentToolCallId"],
    scoped && typeof scoped === "object" && "parentToolCallId" in scoped
      ? scoped.parentToolCallId
      : undefined,
  ];
  return candidates.find(
    (value): value is string => typeof value === "string" && value.length > 0 && value !== block.id,
  );
}
