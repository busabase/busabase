import type { AgentSessionVO } from "busabase-contract/domains/agents/types";

export const getPromptActivityState = (status: AgentSessionVO["status"], sending: boolean) => ({
  active: sending || status === "busy",
  starting: sending && status === "connecting",
});
