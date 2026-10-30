import { ORPCError } from "@orpc/server";
import {
  type AgentConnectionDetailVO,
  AgentConnectionNameSchema,
} from "busabase-contract/domains/agents/types";
import { saveConnectionName } from "./agent-connection-name";
import { getBudaConnectionDetail } from "./buda-connection";
import { getRouterConnectionDetail } from "./router-connection";

export async function getAgentConnectionDetail(slug: string): Promise<AgentConnectionDetailVO> {
  const detail = slug.startsWith("acprouter:")
    ? await getRouterConnectionDetail(slug)
    : slug === "buda" || slug.startsWith("buda:")
      ? await getBudaConnectionDetail(slug)
      : null;
  if (!detail)
    throw new ORPCError("NOT_FOUND", {
      message: "This saved agent connection is no longer available.",
    });
  return detail;
}

export async function renameAgentConnection(
  slug: string,
  inputName: string,
): Promise<AgentConnectionDetailVO> {
  const parsed = AgentConnectionNameSchema.safeParse(inputName);
  if (!parsed.success)
    throw new ORPCError("BAD_REQUEST", {
      message: "Use an agent name between 1 and 100 characters.",
    });
  const detail = await getAgentConnectionDetail(slug);
  if (!detail.ownedByCurrentUser)
    throw new ORPCError("FORBIDDEN", {
      message: "Only the connection owner can rename this agent.",
    });
  await saveConnectionName(detail.slug, parsed.data);
  return { ...detail, agentName: parsed.data };
}
