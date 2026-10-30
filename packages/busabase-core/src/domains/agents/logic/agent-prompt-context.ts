import "server-only";

import { ORPCError } from "@orpc/server";
import {
  agentPromptResourceUri,
  isAgentPromptSourceCompatible,
  type PromptResourceContextInput,
  PromptResourceContextListSchema,
} from "busabase-contract/domains/agents/prompt-context";
import { getContextEmbedOrigin, getContextSpaceId, LOCAL_SPACE_ID } from "../../../context";

/** Revalidate untrusted snapshot data without fetching its descriptive node or URI. */
export function validateAgentPromptResourceContext(
  input: readonly PromptResourceContextInput[] | undefined,
): PromptResourceContextInput[] {
  const contexts = PromptResourceContextListSchema.parse(input ?? []);
  if (contexts.length === 0) return contexts;
  const origin = getContextEmbedOrigin();
  const spaceId = getContextSpaceId();
  const destination = {
    origin: origin ? new URL(origin).origin : "",
    edition: spaceId === LOCAL_SPACE_ID ? ("desktop" as const) : ("cloud" as const),
    ...(spaceId !== LOCAL_SPACE_ID ? { spaceId } : {}),
  };
  if (
    !origin ||
    contexts.some(
      (context) =>
        !isAgentPromptSourceCompatible(
          context.metadata["busabase.agentPrompt"].source,
          destination,
        ),
    )
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The prompt context belongs to a different Busabase origin, edition, or workspace.",
    });
  }
  return contexts.map((context) => ({ ...context, uri: agentPromptResourceUri(context.id) }));
}
