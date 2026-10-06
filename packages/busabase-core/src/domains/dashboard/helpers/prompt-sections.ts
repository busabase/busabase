import type { NodePrompt, NodePromptSource } from "./node-agent-prompts";

export interface PromptSection {
  name: string;
  source: NodePromptSource;
  items: NodePrompt[];
}

export interface PromptSectionLabels {
  builtIn: string;
  custom: string;
  includeEmptyCustom?: boolean;
}

/** Node custom scenarios first, then built-ins, then capability groups. */
export const buildPromptSections = (
  scenarios: NodePrompt[],
  capabilities: NodePrompt[],
  labels: PromptSectionLabels,
): PromptSection[] => {
  const builtIn = scenarios.filter((prompt) => prompt.source === "built-in-scenario");
  const custom = scenarios.filter((prompt) => prompt.source === "custom-scenario");
  const sections: PromptSection[] = [];
  if (custom.length > 0 || labels.includeEmptyCustom) {
    sections.push({ name: labels.custom, source: "custom-scenario", items: custom });
  }
  if (builtIn.length > 0) {
    sections.push({ name: labels.builtIn, source: "built-in-scenario", items: builtIn });
  }

  const capabilitySections = new Map<string, NodePrompt[]>();
  for (const prompt of capabilities) {
    const bucket = capabilitySections.get(prompt.group);
    if (bucket) bucket.push(prompt);
    else capabilitySections.set(prompt.group, [prompt]);
  }

  return [
    ...sections,
    ...[...capabilitySections.entries()].map(([name, items]) => ({
      name,
      source: "capability" as const,
      items,
    })),
  ];
};

export const flattenPromptSections = (sections: PromptSection[]): NodePrompt[] =>
  sections.flatMap((section) => section.items);

export const resolveActivePrompt = (
  sections: PromptSection[],
  selected: string | null,
): NodePrompt | undefined => {
  const prompts = flattenPromptSections(sections);
  return prompts.find((prompt) => prompt.key === selected) ?? prompts[0];
};

/**
 * Once a node has its own prompts, the built-ins (built-in scenarios plus every
 * capability group) fold into one collapsible group below them: the author's
 * prompts are what they came back for, and the built-ins are a starting kit.
 * With no custom prompts the built-ins are all there is, so nothing folds.
 */
export const splitBuiltInSections = (
  sections: PromptSection[],
): { custom: PromptSection[]; builtIn: PromptSection[]; collapsible: boolean } => {
  const custom = sections.filter((section) => section.source === "custom-scenario");
  const builtIn = sections.filter((section) => section.source !== "custom-scenario");
  const collapsible = builtIn.length > 0 && custom.some((section) => section.items.length > 0);
  return { custom, builtIn, collapsible };
};

export const BUILT_IN_PROMPTS_EXPANDED_STORAGE_KEY = "busabase:agent-prompts:built-ins-expanded";
