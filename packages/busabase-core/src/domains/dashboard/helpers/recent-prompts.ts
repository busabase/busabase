/**
 * "Recently used" for the Agent prompts list: the last one or two prompts a
 * person copied or sent from the same kind of place float to the top, so a
 * returning user does not hunt through the whole list again.
 *
 * Remembered per node TYPE and scope kind (a Base's record dialog, a Doc's
 * whole-node dialog, the create modal …) rather than per node: the habit
 * "I always ask for a summary of a table" carries across tables.
 *
 * The storage half degrades silently — private mode, quota, SSR — to "nothing
 * remembered", never to an error in a dialog that only wanted to sort a list.
 */

import type { NodePrompt } from "./node-agent-prompts";
import type { PromptSection } from "./prompt-sections";

export const RECENT_PROMPTS_LIMIT = 2;

const STORAGE_PREFIX = "busabase:agent-prompts:recent:";

export type RecentPromptsContext =
  | { kind: "node"; nodeType: string; scopeKind?: "node" | "field" | "record" | "cell" }
  | { kind: "create" };

export const recentPromptsStorageKey = (context: RecentPromptsContext): string =>
  context.kind === "create"
    ? `${STORAGE_PREFIX}create`
    : `${STORAGE_PREFIX}${context.nodeType}:${context.scopeKind ?? "node"}`;

/** Most recent first, de-duplicated, capped. */
export const pushRecentPromptKey = (
  recent: readonly string[],
  key: string,
  limit = RECENT_PROMPTS_LIMIT,
): string[] => [key, ...recent.filter((existing) => existing !== key)].slice(0, limit);

/**
 * The prompts to show under "Recently used", in recency order. Keys that no
 * longer resolve (a deleted custom prompt, a scenario renamed in an update)
 * are simply skipped.
 */
export const pickRecentPrompts = (
  prompts: readonly NodePrompt[],
  recentKeys: readonly string[],
  limit = RECENT_PROMPTS_LIMIT,
): NodePrompt[] => {
  const byKey = new Map(prompts.map((prompt) => [prompt.key, prompt]));
  const picked: NodePrompt[] = [];
  for (const key of recentKeys) {
    const prompt = byKey.get(key);
    if (prompt && !picked.includes(prompt)) picked.push(prompt);
    if (picked.length >= limit) break;
  }
  return picked;
};

/**
 * Lift the recently used prompts out of their sections so they can be shown
 * first under their own heading. They are MOVED, not copied: a prompt that
 * appeared twice would have two list rows claiming `aria-current` and two
 * stops in the arrow-key order. A section that only held recent prompts
 * disappears, except the custom section, which keeps its "Add prompt" slot.
 */
export const partitionRecentPrompts = (
  sections: readonly PromptSection[],
  recentKeys: readonly string[],
): { recent: NodePrompt[]; sections: PromptSection[] } => {
  const recent = pickRecentPrompts(
    sections.flatMap((section) => section.items),
    recentKeys,
  );
  if (recent.length === 0) return { recent, sections: [...sections] };
  const lifted = new Set(recent.map((prompt) => prompt.key));
  const rest = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((prompt) => !lifted.has(prompt.key)),
    }))
    .filter(
      (section, index) =>
        section.items.length > 0 ||
        section.source === "custom-scenario" ||
        (sections[index]?.items.length ?? 0) === 0,
    );
  return { recent, sections: rest };
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const readRecentPromptKeys = (storageKey: string): string[] => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return isStringArray(parsed) ? parsed.slice(0, RECENT_PROMPTS_LIMIT) : [];
  } catch {
    return [];
  }
};

export const writeRecentPromptKeys = (storageKey: string, keys: readonly string[]): void => {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(keys.slice(0, RECENT_PROMPTS_LIMIT)));
  } catch {
    // Storage unavailable — the list just isn't reordered next time.
  }
};
