import type {
  AgentSessionVO,
  SetAgentSessionConfigOptionInput,
} from "busabase-contract/domains/agents/types";

export type ModelConfigSelection = SetAgentSessionConfigOptionInput & { thinkingValue?: string };

/** Apply a dependent level only after the agent confirms the requested model. */
export async function applyModelConfigSelection(
  setOption: (input: SetAgentSessionConfigOptionInput) => Promise<AgentSessionVO>,
  { thinkingValue, ...input }: ModelConfigSelection,
): Promise<AgentSessionVO> {
  const confirmed = await setOption(input);
  if (thinkingValue === undefined) return confirmed;
  if (
    confirmed.id !== input.sessionId ||
    confirmed.modelOption?.id !== input.configId ||
    confirmed.modelOption.currentValue !== input.value
  ) {
    throw new Error(
      "The agent did not confirm the requested model. Thinking level was not changed.",
    );
  }
  const thinking = confirmed.thinkingOption;
  if (!thinking?.options.some((level) => level.value === thinkingValue)) {
    throw new Error("The selected model no longer offers that thinking level.");
  }
  if (thinking.currentValue === thinkingValue) return confirmed;
  return setOption({ sessionId: confirmed.id, configId: thinking.id, value: thinkingValue });
}
