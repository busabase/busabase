/**
 * Demo data adapter — maps DEMO_* seed constants to OpenAPI input shapes.
 * Both the DB seed (store.ts) and these demo scripts consume the same source,
 * so API behaviour and seeded state always reflect identical content.
 */

// biome-ignore lint/correctness/noUnusedImports: re-exported for consumers
export {
  DEMO_BASES,
  DEMO_BLOG_BASE_ID,
  DEMO_CONTENT_FOLDER_NODE_ID,
  DEMO_CRM_COMPANIES_BASE_ID,
  DEMO_CRM_CONTACTS_BASE_ID,
  DEMO_CRM_DEALS_BASE_ID,
  DEMO_CRM_FOLDER_NODE_ID,
  DEMO_FOLDERS,
  DEMO_NEWSLETTER_BASE_ID,
  DEMO_RECORDS,
  DEMO_SOCIAL_BASE_ID,
} from "busabase-core/demo/dataset";

import { DEMO_BASES, DEMO_RECORDS } from "busabase-core/demo/dataset";

type SeedFieldDef = {
  id: string;
  slug: string;
  name: string;
  type: string;
  required: boolean;
  options: Record<string, unknown>;
};
type SeedBaseDef = {
  id: string;
  nodeId: string;
  slug: string;
  name: string;
  description: string;
  folderNodeId: string;
  fields: SeedFieldDef[];
};

/** Strip the DB-specific `id` from a SeedFieldDef → API createBase field input. */
export function toApiField(f: SeedFieldDef) {
  return {
    slug: f.slug,
    name: f.name,
    type: f.type,
    required: f.required,
    options: f.options,
  };
}

/** Map a seed base def to a POST /bases body (omits DB-specific fields). */
export function toApiBase(b: SeedBaseDef) {
  return {
    slug: b.slug,
    name: b.name,
    description: b.description,
    fields: b.fields
      .filter((f) => !["relation", "ai_summary", "ai_tags", "created_time"].includes(f.type))
      .slice(0, 8)
      .map(toApiField),
  };
}

/** Blog records from DEMO_RECORDS, adapted to { fields, message, author }. */
export const DEMO_BLOG_RECORDS = DEMO_RECORDS.filter(
  (r) => r.baseId === DEMO_BASES.find((b) => b.slug === "blog")?.id,
).map((r) => ({
  fields: r.fields as Record<string, unknown>,
  message: r.message,
  author: r.author,
}));

/** CRM company records from DEMO_RECORDS. */
export const DEMO_COMPANY_RECORDS = DEMO_RECORDS.filter(
  (r) => r.baseId === DEMO_BASES.find((b) => b.slug === "companies")?.id,
).map((r) => ({
  fields: r.fields as Record<string, unknown>,
  message: r.message,
  author: r.author,
}));

/** Skills to seed via the Skills OpenAPI — matches what demo-skills.ts had inline. */
export const DEMO_SKILLS = [
  {
    slug: "agent-rules",
    name: "Agent Rules",
    description: "Align all AI coding agents to a single source of truth.",
    version: "4.0.0",
    visibility: "workspace" as const,
    files: [
      {
        path: "SKILL.md",
        content: `---
name: agent-rules
description: Align all AI coding agents to single source of truth.
allowed-tools: Read, Write, Edit, Bash
---

# Agent Rules

Ensure all AI coding agents use the same rules and skills via symlinks.

## Quick Start

\`\`\`bash
/agent-rules              # Align all agents
/agent-rules --check      # Verify alignment
\`\`\`

## Single Source of Truth

1. **Rules**: \`AGENTS.md\` (project root)
2. **Skills**: \`.agents/skills/\`
`,
      },
      {
        path: "README.md",
        content: "# Agent Rules\n\nAlign all AI coding agents.\n",
      },
    ],
  },
  {
    slug: "code-review",
    name: "Code Review",
    description: "Systematic code review checklist for pull requests.",
    version: "1.0.0",
    visibility: "workspace" as const,
    files: [
      {
        path: "SKILL.md",
        content: `---
name: code-review
description: Systematic PR review checklist.
---

# Code Review Skill

## Checklist

- [ ] Types correct (no \`any\`)
- [ ] No hardcoded secrets
- [ ] Error cases handled
- [ ] Tests cover changed behaviour
- [ ] Changelog added if ≥ 3 files changed
`,
      },
    ],
  },
  {
    slug: "typescript-best-practices",
    name: "TypeScript Best Practices",
    description: "TypeScript patterns and anti-patterns for this monorepo.",
    version: "1.0.0",
    visibility: "workspace" as const,
    files: [
      {
        path: "SKILL.md",
        content: `---
name: typescript-best-practices
description: TypeScript patterns for this monorepo.
---

# TypeScript Best Practices

## Do ✅
- \`async/await\` — never \`.then()\`
- Arrow functions
- \`unknown\` + narrowing over \`any\`

## Avoid ❌
- \`any\`
- Class components
- Raw \`sql\` template literals
`,
      },
    ],
  },
];
