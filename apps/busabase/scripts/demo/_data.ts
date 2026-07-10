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
import type { iString } from "openlib/i18n/i-string";

type SeedFieldDef = {
  id: string;
  slug: string;
  name: iString;
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
    // This walkthrough asserts on the materialized Base immediately after POST
    // (it's smoke-testing the API surface, not the review-first policy), so it
    // opts out of the new review-first default the same way a seed script does.
    autoMerge: true,
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

/** System fields the server computes itself (`computeSystemFieldValues`) — they have a
 *  read-only "computed" input and can't be set on create. Everything else (incl.
 *  attachment, relation, ai_summary, ai_tags) is real user data we DO send. */
const COMPUTED_FIELD_TYPES = [
  "created_time",
  "updated_time",
  "created_by",
  "updated_by",
  "auto_number",
];

/** Bases we populate with persistent, clean-named demo records — ordered so a base's
 *  relation TARGETS (contacts, social posts) are created before the bases that link to
 *  them (companies → contacts, blog → social), enabling seed-id → real-id remapping. */
export const DEMO_PERSISTENT_RECORD_BASES = [
  // ── No relation dependencies — create first (targets for the rest) ──
  "companies",
  "purchase-orders",
  "media-assets",
  "private-knowledge",
  "ops-tasks",
  "routine-work-log",
  "compliance-checklists",
  "market-research",
  "content-pipeline",
  "qa-training-dataset",
  "labeling-queue",
  "pages",
  "services",
  // ── Depend on the bases above (created after their relation targets) ──
  "contacts", // → companies
  "deals", // → companies, contacts
  "invoices", // → purchase-orders
  "social-content", // → blog (back-edge stays empty; blog comes after)
  "blog", // → social-content
  "newsletter", // → blog
  "field-type-lab", // → blog; exercises EVERY field type (code, html, longtext, …)
] as const;

/** Seed records for a base, adapted for the REST record API. Drops only computed system
 *  fields; keeps attachment/relation/ai values. Surfaces the seed record id (for relation
 *  remapping), the relation field slugs, and the identity value (for idempotency). */
export function recordsForBase(slug: string): Array<{
  seedId: string;
  identity: string;
  identityValue: string;
  fields: Record<string, unknown>;
  relationSlugs: string[];
  message?: string;
}> {
  const base = DEMO_BASES.find((b) => b.slug === slug);
  if (!base) return [];
  const computed = new Set(
    base.fields.filter((f) => COMPUTED_FIELD_TYPES.includes(f.type)).map((f) => f.slug),
  );
  const relationSlugs = base.fields.filter((f) => f.type === "relation").map((f) => f.slug);
  // Valid values per select/multiselect field. Some seed records carry values that aren't
  // in the field's options (the direct DB seed never validates; the REST API does), so we
  // drop a bad select value / filter a multiselect to its valid subset. The server accepts
  // either a choice id OR its name (field-types.ts: `choice.id === v || choice.name === v`),
  // and a field with no choices is unconstrained — so we only constrain when choices exist.
  const choices = new Map<string, { multi: boolean; valid: Set<string> }>();
  for (const f of base.fields) {
    if (f.type !== "select" && f.type !== "multiselect") continue;
    const list = (f.options as { choices?: Array<{ id: string; name?: string }> }).choices ?? [];
    if (list.length === 0) continue; // unconstrained — accept any value
    const valid = new Set<string>();
    for (const c of list) {
      valid.add(c.id);
      if (c.name) valid.add(c.name);
    }
    choices.set(f.slug, { multi: f.type === "multiselect", valid });
  }
  // Identity = the field we search on for idempotency: prefer title / name, else the first
  // non-relation/attachment value field (some bases have neither title nor a plain text field).
  const idField =
    base.fields.find((f) => f.slug === "title") ??
    base.fields.find((f) => f.slug === "name") ??
    base.fields.find((f) => f.type === "text") ??
    base.fields.find((f) => ["longtext", "markdown"].includes(f.type)) ??
    base.fields.find(
      (f) => !["relation", "attachment"].includes(f.type) && !computed.has(f.slug),
    ) ??
    base.fields[0];
  const identity = idField?.slug ?? "title";
  return DEMO_RECORDS.filter((r) => r.baseId === base.id)
    .map((r) => {
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r.fields as Record<string, unknown>)) {
        if (computed.has(k)) continue;
        const ch = choices.get(k);
        // Drop a select value not in the field's options.
        if (ch && !ch.multi && typeof v === "string" && !ch.valid.has(v)) continue;
        // Filter a multiselect to its valid subset; pass everything else through unchanged.
        fields[k] =
          ch?.multi && Array.isArray(v)
            ? v.filter((x) => typeof x === "string" && ch.valid.has(x))
            : v;
      }
      return {
        seedId: r.id,
        identity,
        identityValue: String(
          fields[identity] ?? (r.fields as Record<string, unknown>)[identity] ?? "",
        ),
        fields,
        relationSlugs,
        message: r.message,
      };
    })
    .filter((r) => r.identityValue);
}

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
