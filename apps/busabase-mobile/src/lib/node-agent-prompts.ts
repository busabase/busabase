// Copy-pasteable Agent prompts, scoped to one node — the mobile port of
// packages/busabase-core/src/domains/dashboard/helpers/node-agent-prompts.ts.
//
// The core helper is NOT re-exported from busabase-core's package entry points,
// so this app can't import it; the logic is mirrored here instead and every
// string lives in the mobile catalog (`t.agentPrompts`) so both locales stay
// under the same review as the rest of the app. Keep the two in sync.
//
// Two deliberately different tiers, exactly as on web:
//  - **capability** — machine-shaped and exhaustive: one entry per operation the
//    node type registers, derived straight from the shared node-type registry,
//    so a new node type gets a complete prompt set for free.
//  - **scenario** — human-shaped and curated: task-level things people actually
//    ask for, hand-written per node type, and only for the types where they earn
//    their keep. A type with no scenarios shows the capability tier alone.

import {
  GENERIC_NODE_OPERATION_KINDS,
  getNodeType,
  OPERATION_META,
} from "busabase-contract/domains";
import { type CoreMessages, fmt } from "~/i18n/messages";

export type PromptTier = "scenario" | "capability";

export interface NodePromptContext {
  nodeType: string;
  nodeName: string;
  nodeId: string;
  spaceId?: string | null;
  spaceName?: string | null;
}

export interface NodePrompt {
  /** Stable key — used for list selection and as the copy-state key. */
  key: string;
  tier: PromptTier;
  /** Localized, human-readable label shown in the list. */
  label: string;
  /** Localized group heading ("Records", "Fields", …) the list buckets this under. */
  group: string;
  /** The final, fully-interpolated text the user copies. */
  body: string;
}

type GroupKey = "record" | "field" | "view" | "content" | "node" | "other";

/**
 * Which group heading an operation falls under. Keyed by the operation kind's
 * prefix so a plugin type's `myplugin_*` operations bucket under their own type
 * label instead of silently landing in "General". Same rules as web.
 */
const groupOf = (kind: string): GroupKey => {
  if (kind.startsWith("record_")) return "record";
  if (kind.startsWith("view_")) return "view";
  if (kind.startsWith("node_")) return "node";
  if (kind.includes("_field")) return "field";
  if (kind.includes("_file") || kind.endsWith("_update") || kind.includes("_metadata")) {
    return "content";
  }
  return "other";
};

/** Display order of the groups in the capability list. */
const GROUP_ORDER: GroupKey[] = ["record", "field", "view", "content", "other", "node"];

const groupLabel = (t: CoreMessages, key: GroupKey): string => {
  const labels: Record<GroupKey, string> = {
    record: t.agentPrompts.groupRecord,
    field: t.agentPrompts.groupField,
    view: t.agentPrompts.groupView,
    content: t.agentPrompts.groupContent,
    node: t.agentPrompts.groupGeneral,
    other: t.agentPrompts.groupOther,
  };
  return labels[key];
};

/**
 * The curated scenario tier, keyed by node type. Each entry names the pair of
 * catalog keys holding its label and body — the strings themselves live in
 * `messages.ts` (both locales), matching how every other mobile surface works.
 */
type ScenarioKey = keyof CoreMessages["agentPrompts"];

interface ScenarioDef {
  key: string;
  labelKey: ScenarioKey;
  bodyKey: ScenarioKey;
}

const scenario = (key: string, labelKey: ScenarioKey, bodyKey: ScenarioKey): ScenarioDef => ({
  key,
  labelKey,
  bodyKey,
});

const SCENARIOS_BY_TYPE: Record<string, ScenarioDef[]> = {
  base: [
    scenario("base-bulk-import", "baseBulkImportLabel", "baseBulkImportBody"),
    scenario("base-design-schema", "baseDesignSchemaLabel", "baseDesignSchemaBody"),
    scenario("base-dedupe", "baseDedupeLabel", "baseDedupeBody"),
    scenario("base-summarize", "baseSummarizeLabel", "baseSummarizeBody"),
  ],
  doc: [
    scenario("doc-draft", "docDraftLabel", "docDraftBody"),
    scenario("doc-review", "docReviewLabel", "docReviewBody"),
  ],
  drive: [
    scenario("drive-organize", "driveOrganizeLabel", "driveOrganizeBody"),
    scenario("drive-summarize", "driveSummarizeLabel", "driveSummarizeBody"),
  ],
  skill: [scenario("skill-improve", "skillImproveLabel", "skillImproveBody")],
  airapp: [
    scenario("airapp-add-feature", "airappAddFeatureLabel", "airappAddFeatureBody"),
    scenario("airapp-debug", "airappDebugLabel", "airappDebugBody"),
  ],
};

/**
 * Build every prompt available for one node, already localized and interpolated.
 * Returns both tiers; the sheet renders them as separate tabs.
 */
export function buildNodeAgentPrompts(
  context: NodePromptContext,
  t: CoreMessages,
): { scenarios: NodePrompt[]; capabilities: NodePrompt[] } {
  const definition = getNodeType(context.nodeType);
  const typeLabel = definition?.label ?? context.nodeType;
  const target = context.spaceId
    ? fmt(t.agentPrompts.targetWithSpace, {
        type: typeLabel,
        name: context.nodeName,
        nodeId: context.nodeId,
        spaceName: context.spaceName ?? context.spaceId,
        spaceId: context.spaceId,
      })
    : fmt(t.agentPrompts.target, {
        type: typeLabel,
        name: context.nodeName,
        nodeId: context.nodeId,
      });
  const footer = t.agentPrompts.footer;

  const scenarios: NodePrompt[] = (SCENARIOS_BY_TYPE[context.nodeType] ?? []).map(
    (definitionOf) => ({
      key: definitionOf.key,
      tier: "scenario",
      label: t.agentPrompts[definitionOf.labelKey],
      group: groupLabel(t, "content"),
      body: `${fmt(t.agentPrompts[definitionOf.bodyKey], { target })}\n\n${footer}`,
    }),
  );

  // Type-specific operations first, then the generic node_* tree ops every type has.
  const kinds = [
    ...(definition?.operations ?? []).map((operation) => operation.kind),
    ...GENERIC_NODE_OPERATION_KINDS,
  ];

  const capabilities: NodePrompt[] = kinds.map((kind) => {
    // Operation labels come from the shared registry, which is what every other
    // mobile surface already shows (see `operationLabels` in lib/busabase-display).
    // Web can additionally translate them via `messages.operation.*`; the mobile
    // catalog has no such block, so these read in the registry's English on both
    // locales — the same fallback web uses for an untranslated plugin operation.
    const opLabel =
      OPERATION_META[kind as keyof typeof OPERATION_META]?.label ??
      definition?.operations.find((operation) => operation.kind === kind)?.label ??
      kind;
    return {
      key: kind,
      tier: "capability" as const,
      label: opLabel,
      group: groupLabel(t, groupOf(kind)),
      body: `${fmt(t.agentPrompts.capabilityBody, { target, operation: opLabel })}\n\n${footer}`,
    };
  });

  // Stable, readable ordering: group by bucket in GROUP_ORDER, preserving each
  // bucket's registry order inside it.
  const rank = new Map(GROUP_ORDER.map((key, index) => [groupLabel(t, key), index]));
  capabilities.sort(
    (a, b) => (rank.get(a.group) ?? GROUP_ORDER.length) - (rank.get(b.group) ?? GROUP_ORDER.length),
  );

  return { scenarios, capabilities };
}
