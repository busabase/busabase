import type { SeedScenario } from "../seed-types";

// English per-node-type example content: Docs + Files + review Comments. Shipped via
// `pnpm db:seed:all`, on top of the scenario's folders/bases/records. The zh-CN
// counterpart (`node-types.zh-cn.ts`) mirrors this structure with different data.

const DOC_GUIDE_CR_ID = "crq_seed_doc_operating_guide";

export const enNodeTypesScenario: SeedScenario = {
  docs: [
    {
      nodeId: "nod_doc_agent_operating_guide",
      slug: "agent-operating-guide",
      name: "Agent Operating Guide",
      description: "How agents propose, review, and merge changes in this workspace.",
      position: 0,
      body: `# Agent Operating Guide

Every change in this workspace — a record, a Skill file, a Doc, a schema tweak —
is proposed as a **change request** and merged only after review. Nothing an agent
does lands silently.

## How agents work here

1. Read the relevant Base, Doc, or Skill.
2. Open a change request describing *what* changes and *why*.
3. Wait for an approval before the change merges.
4. Cite a source or an internal record id for every factual claim.

## Why approval-first

The workspace is the shared memory a team of agents and humans edit together, so a
reviewable, revertible history matters more than raw write speed.
`,
      changeRequest: {
        id: DOC_GUIDE_CR_ID,
        operationId: "opr_seed_doc_operating_guide",
        commitId: "cmt_seed_doc_operating_guide",
        submittedBy: "docs-maintainer-agent",
        minutesAgo: 4,
        message: "Add an escalation section to the Agent Operating Guide",
        nextBody: `# Agent Operating Guide

Every change in this workspace — a record, a Skill file, a Doc, a schema tweak —
is proposed as a **change request** and merged only after review. Nothing an agent
does lands silently.

## How agents work here

1. Read the relevant Base, Doc, or Skill.
2. Open a change request describing *what* changes and *why*.
3. Wait for an approval before the change merges.
4. Cite a source or an internal record id for every factual claim.

## Escalation

If a change request is blocked for more than a day, flag a human reviewer instead
of merging around the block.
`,
      },
    },
    {
      nodeId: "nod_doc_launch_runbook",
      slug: "launch-runbook",
      name: "Launch Runbook",
      description: "The steps an agent follows to ship an approved change to a live channel.",
      position: 1,
      body: `# Launch Runbook

The steps an agent follows to ship an approved change to a live channel.

## Preflight

- Confirm the change request is approved and merged.
- Check the target Base view has no open conflicting change requests.

## Ship

1. Export the merged records for the channel.
2. Post through the channel adapter.
3. Record the external id back on the record via a new change request.

## Rollback

If a published item is wrong, open a revert change request — never edit the channel
out of band.
`,
    },
    {
      nodeId: "nod_doc_data_dictionary",
      slug: "data-dictionary",
      name: "Data Dictionary",
      description: "Shared field definitions for the CRM Bases.",
      position: 2,
      body: `# Data Dictionary

Shared definitions for the CRM Bases so agents and humans read every field the same way.

## Companies

- **name** — legal entity name.
- **status** — one of \`lead\`, \`active\`, \`churned\`.

## Contacts

- **status** — one of \`new\`, \`engaged\`, \`customer\`.
- **company** — relation to a Companies record.

Keep this doc in sync through change requests whenever a Base schema changes.
`,
    },
  ],
  files: [
    {
      nodeId: "nod_file_product_brief",
      slug: "product-brief",
      name: "Product Brief",
      description: "A first-class File node backed by an Asset.",
      fileName: "product-brief.md",
      mimeType: "text/markdown; charset=utf-8",
      attachmentId: "att_seed_product_brief",
      assetId: "ast_seed_product_brief",
      storageKey: "attachments/blobs/seed/product-brief.md",
      position: 0,
      body: `# Product Brief

Busabase is the approval-first database for AI agents: every write is a reviewable
change request, so a team of agents and humans can share one editable source of
truth without stepping on each other.

- Agents propose; reviewers approve; history is revertible.
- Bases, Docs, Skills, Drives, and Files all live in one workspace tree.
- This file is a first-class **File node** backed by the Asset library.
`,
    },
    {
      nodeId: "nod_file_q3_metrics",
      slug: "q3-metrics",
      name: "Q3 Metrics",
      description: "A CSV File node — the kind of data file an agent attaches for review.",
      fileName: "q3-metrics.csv",
      mimeType: "text/csv",
      attachmentId: "att_seed_q3_metrics",
      assetId: "ast_seed_q3_metrics",
      storageKey: "attachments/blobs/seed/q3-metrics.csv",
      position: 1,
      body: `metric,q2,q3,delta
weekly_active_agents,820,1240,+51%
change_requests_merged,3110,4870,+57%
avg_review_minutes,42,28,-33%
`,
    },
    {
      nodeId: "nod_file_brand_palette",
      slug: "brand-palette",
      name: "Brand Palette",
      description: "A JSON File node holding the workspace brand tokens.",
      fileName: "brand-palette.json",
      mimeType: "application/json",
      attachmentId: "att_seed_brand_palette",
      assetId: "ast_seed_brand_palette",
      storageKey: "attachments/blobs/seed/brand-palette.json",
      position: 2,
      body: `{
  "name": "Busabase",
  "colors": {
    "primary": "#2f6f4f",
    "ink": "#0f172a",
    "paper": "#f8fafc"
  },
  "voice": "calm, precise, approval-first"
}
`,
    },
  ],
  comments: [
    {
      id: "com_seed_blog_review_1",
      subjectType: "change_request",
      subjectId: "crq_seed",
      authorId: "local-editor",
      body: 'Strong thesis. Before I approve, can you ground the "next control surface" claim with a dated source? @agent',
      mentionsAi: true,
      minutesAgo: 34,
    },
    {
      id: "com_seed_blog_review_2",
      subjectType: "change_request",
      subjectId: "crq_seed",
      authorId: "ai-research-agent",
      body: 'Good call — I softened it to "may become" and added two dated launch notes as sources in the body.',
      minutesAgo: 29,
    },
    {
      id: "com_seed_social_batch_1",
      subjectType: "change_request",
      subjectId: "crq_seed_social_batch",
      authorId: "social-editor-agent",
      body: "Bundling the create + update + archive so the weekly thread lands as one reviewable change instead of three.",
      minutesAgo: 14,
    },
    {
      id: "com_seed_doc_guide_1",
      subjectType: "change_request",
      subjectId: DOC_GUIDE_CR_ID,
      authorId: "local-editor",
      body: "Nice addition — let's make the escalation window explicit (24h) before we merge.",
      minutesAgo: 3,
    },
    {
      id: "com_seed_skill_1",
      subjectType: "change_request",
      subjectId: "crq_seed_skill_research_editor",
      authorId: "skill-maintainer-agent",
      body: "The merge-guardrails section keeps unsourced market claims out. @agent please double-check the benchmark line.",
      mentionsAi: true,
      minutesAgo: 5,
    },
    {
      id: "com_seed_record_1",
      subjectType: "record",
      subjectId: "rec_seed_blog_approval",
      authorId: "local-viewer",
      body: "Reads much better with the sources inline. Ready for the newsletter once this merges.",
      minutesAgo: 18,
    },
  ],
};
