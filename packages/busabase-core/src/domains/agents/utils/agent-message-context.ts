import type { CoreLocale } from "../../../i18n";
import { renderNodeTargetLine } from "../../dashboard/helpers/node-agent-prompts";
import type { LoadedNode } from "../../dashboard/node-detail-registry";

/**
 * Prepend "which node the user means" to a message they typed themselves.
 *
 * Pure, and separate from the composer, because this is the part with a rule in
 * it: the context goes ABOVE the user's text, never woven into it, and an absent
 * node changes nothing at all. Both halves are easy to get subtly wrong in a
 * component and impossible to see once they are.
 *
 * The line itself comes from the same renderer the Agent-prompts bodies use, so
 * an agent meets one phrasing of this fact rather than two.
 */
export const withNodeContext = (
  text: string,
  node: LoadedNode | null | undefined,
  locale: CoreLocale,
  spaceId?: string,
): string => {
  if (!node) return text;
  const target = renderNodeTargetLine(
    { nodeId: node.id, nodeName: node.name, nodeType: node.type, spaceId },
    locale,
  );
  return `${target}\n\n${text}`;
};
