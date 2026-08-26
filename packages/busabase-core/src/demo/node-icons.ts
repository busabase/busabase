import { type NodeIcon, NodeIconSchema } from "busabase-contract/types";
import type { SeedScenario } from "./seed-types";

type SeedNodeKind =
  | "airapp"
  | "base"
  | "doc"
  | "drive"
  | "file"
  | "folder"
  | "form"
  | "html"
  | "skill"
  | "whiteboard"
  | "workflow";

interface SeedNodeIconInput {
  icon?: NodeIcon;
  name: string;
  nodeType: SeedNodeKind;
  slug: string;
}

const emojiIcon = (value: string): NodeIcon => NodeIconSchema.parse({ type: "emoji", value });

/**
 * Stable content semantics for the shipped demo. Slugs are locale-independent,
 * so English and Simplified Chinese render the same recognizable visual cues.
 */
const DEMO_NODE_EMOJI_BY_SLUG: Readonly<Record<string, string>> = {
  root: "🏠",
  cms: "📰",
  marketing: "📣",
  crm: "🤝",
  finance: "💰",
  "stock-picking": "📈",
  "formula-lab": "🧮",
  "personal-knowledge": "🧠",
  operations: "⚙️",
  "routine-work": "🔁",
  compliance: "🛡️",
  research: "🔬",
  "content-factory": "🏭",
  datasets: "🧪",
  config: "🔧",
  lab: "🧪",
  "visual-tools": "🎨",
  blog: "📝",
  "social-content": "💬",
  newsletter: "📨",
  "media-assets": "🖼️",
  "field-type-lab": "🧰",
  companies: "🏢",
  contacts: "👤",
  deals: "💼",
  "purchase-orders": "🛒",
  invoices: "🧾",
  "stock-watchlist": "📊",
  "directory-listings": "📍",
  "agent-gallery": "🤖",
  roadmap: "🗺️",
  "agent-integrations": "🔌",
  "expense-reimbursements": "💳",
  "meeting-notes": "📅",
  "project-docs": "📚",
  "event-planning": "🎟️",
  "channel-management": "📡",
  todos: "✅",
  "weekly-reports": "📊",
  "risk-register": "⚠️",
  "contract-ledger": "📜",
  "competitor-analysis": "🔎",
  "user-interviews": "🎙️",
  "topic-ideas": "💡",
  "editorial-calendar": "🗓️",
  "model-evals": "🧪",
  "private-knowledge": "🔐",
  "ops-tasks": "⚙️",
  "routine-work-log": "🔁",
  "compliance-checklists": "🛡️",
  "market-research": "🔬",
  "content-pipeline": "🏭",
  "qa-training-dataset": "🧠",
  "labeling-queue": "🏷️",
  pages: "🌐",
  services: "🔧",
  "nextjs-fumadocs-demo-cms-categories": "🗂️",
  "nextjs-fumadocs-demo-cms-tags": "🏷️",
  "agent-operating-guide": "📖",
  "launch-runbook": "🚀",
  "data-dictionary": "📚",
  "product-brief": "📄",
  "q3-metrics": "📊",
  "brand-palette": "🎨",
  "ai-research-editor": "🧠",
  "team-files": "🗄️",
  "demo-pure-html": "🌐",
  "demo-hono-api": "🔌",
  "demo-sqlite": "🗃️",
  "demo-deal-pipeline": "💼",
  "demo-compliance-board": "🛡️",
  "product-launch-whiteboard": "🚀",
  "lead-intake-workflow": "🔀",
  "waitlist-form-prototype": "✍️",
  "guest-post-form": "✍️",
  docs: "📚",
  files: "📁",
  skills: "🧰",
  drives: "🗄️",
  airapps: "🚀",
  "globex-cloud-invoice-2026-06-demo": "🧾",
};

const DEFAULT_EMOJI_BY_KIND: Readonly<Record<SeedNodeKind, string>> = {
  airapp: "🚀",
  base: "🗂️",
  doc: "📄",
  drive: "🗄️",
  file: "📎",
  folder: "📁",
  form: "✍️",
  html: "🌐",
  skill: "🧰",
  whiteboard: "🎨",
  workflow: "🔀",
};

/** Parse an explicit icon, or derive a valid emoji icon from stable seed data. */
export const seedNodeIcon = ({ icon, nodeType, slug }: SeedNodeIconInput): NodeIcon =>
  icon
    ? NodeIconSchema.parse(icon)
    : emojiIcon(DEMO_NODE_EMOJI_BY_SLUG[slug] ?? DEFAULT_EMOJI_BY_KIND[nodeType]);

/** Materialize icons on every data-driven node definition in a scenario. */
export const withSeedNodeIcons = (scenario: SeedScenario): SeedScenario => ({
  ...scenario,
  folders: scenario.folders?.map((def) => ({
    ...def,
    icon: seedNodeIcon({ ...def, nodeType: "folder" }),
  })),
  bases: scenario.bases?.map((def) => ({
    ...def,
    icon: seedNodeIcon({ ...def, nodeType: "base" }),
  })),
  docs: scenario.docs?.map((def) => ({
    ...def,
    icon: seedNodeIcon({ ...def, nodeType: "doc" }),
  })),
  files: scenario.files?.map((def) => ({
    ...def,
    icon: seedNodeIcon({ ...def, nodeType: "file" }),
  })),
  fileTreeNodes: scenario.fileTreeNodes?.map((def) => ({
    ...def,
    icon: seedNodeIcon({ ...def, nodeType: def.nodeType }),
  })),
  richNodes: scenario.richNodes?.map((def) => ({
    ...def,
    icon: seedNodeIcon({ ...def, nodeType: def.nodeType }),
  })),
  forms: scenario.forms?.map((def) => ({
    ...def,
    icon: seedNodeIcon({ ...def, nodeType: "form" }),
  })),
});

export const DEMO_ROOT_NODE_ICON = seedNodeIcon({
  name: "Local workspace",
  nodeType: "folder",
  slug: "root",
});

export const DEMO_GREP_FILE_NODE_ICON = seedNodeIcon({
  name: "Globex Cloud Invoice (grep demo)",
  nodeType: "file",
  slug: "globex-cloud-invoice-2026-06-demo",
});
