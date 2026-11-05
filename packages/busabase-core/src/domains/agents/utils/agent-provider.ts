import type { AgentConnectionVO } from "busabase-contract/domains/agents/types";

const providerNames = new Map([
  ["claude-acp", "Claude Code"],
  ["codex-acp", "Codex"],
  ["buda", "Buda"],
]);

export function getAgentProviderName(
  connection: Pick<AgentConnectionVO, "slug" | "providerAgentSlug">,
): string {
  const slug = connection.providerAgentSlug ?? connection.slug;
  return (
    providerNames.get(slug.startsWith("buda:") ? "buda" : slug) ??
    (slug.startsWith("acprouter:") ? "ACP" : slug)
  );
}
