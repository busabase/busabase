import { AIRAPP_DEMO_HONO_API, AIRAPP_DEMO_SQLITE } from "../../domains/airapp/demo-content";
import type { SeedScenario } from "../seed-types";

// English per-node-type example content: Skills + Drives + AirApps + Docs + Files +
// review Comments. Shipped via `pnpm db:seed:all`, on top of the scenario's
// folders/bases/records. The zh-CN counterpart (`node-types.zh-cn.ts`) mirrors this
// structure with different data — AirApps are English-only for now (see the
// canvas-node changelog for why).
//
// AirApp content comes from `domains/airapp/demo-content` — the same catalog
// `apps/busabase/scripts/demo/14-airapps.ts` uses to create all 6 demos via
// the REST API, so the two never drift. Only the two fast, dependency-light
// demos (Hono API, SQLite) are seeded here; the Vite-based ones (slower
// installs, two of them deliberately broken) are left out of this fast
// baseline seed.

const DOC_GUIDE_CR_ID = "crq_seed_doc_operating_guide";

// ── Skill: AI Research Editor ────────────────────────────────────────────────
// Same content that used to be hardcoded directly in seed.ts's
// `seedSkillNodeIfMissing` — moved here verbatim so it's scenario-driven instead.

const AI_RESEARCH_EDITOR_SKILL_MD = `---\nname: ai-research-editor\ndescription: Reviews agent research drafts for source quality before publishing.\n---\n\n# AI Research Editor\n\nUse this skill when an agent proposes AI industry analysis, newsletter copy, or social threads that need source checks before merge.\n\n## Workflow\n\n1. Read the proposed ChangeRequest operations.\n2. Check whether every factual claim has a source URL or a clear internal record reference.\n3. Flag unsupported claims before approval.\n4. Keep edits concise and preserve the author's thesis.\n`;

export const enNodeTypesScenario: SeedScenario = {
  fileTreeNodes: [
    {
      nodeType: "skill",
      nodeId: "nod_skill_ai_research_editor",
      slug: "ai-research-editor",
      name: "AI Research Editor",
      description: "Reviews agent research drafts for source quality before publishing.",
      position: 0,
      files: [
        { path: "SKILL.md", content: AI_RESEARCH_EDITOR_SKILL_MD },
        {
          path: "skill.json",
          content: `${JSON.stringify(
            {
              name: "ai-research-editor",
              description: "Reviews agent research drafts for source quality before publishing.",
              version: "0.1.0",
            },
            null,
            2,
          )}\n`,
        },
        {
          path: "references/source-policy.md",
          content:
            "# Source policy\n\nPrefer primary sources, official documentation, direct company posts, and clearly dated analyst notes. Reject claims that only cite vague social chatter.\n",
        },
        {
          path: "examples/review-comment.md",
          content:
            "This draft is directionally useful, but the claim about enterprise adoption needs a dated source before approval.\n",
        },
      ],
      changeRequest: {
        id: "crq_seed_skill_research_editor",
        operationId: "opr_seed_skill_research_editor",
        commitId: "cmt_seed_skill_research_editor",
        submittedBy: "skill-maintainer-agent",
        minutesAgo: 6,
        filePath: "SKILL.md",
        nextContent: `${AI_RESEARCH_EDITOR_SKILL_MD}\n## Merge guardrails\n\n- Do not approve drafts that lack source receipts for market-size, policy, or benchmark claims.\n- Prefer a short reviewer note over rewriting the entire article.\n`,
        message: "Add merge guardrails to AI Research Editor Skill",
        scenario: "skill-file-update",
        workflow: "skill-governance",
      },
    },
    {
      nodeType: "drive",
      nodeId: "nod_drive_team_files",
      slug: "team-files",
      name: "Team Files",
      description:
        "A plain file drive for team documents — onboarding, policy, and shared reference files.",
      position: 0,
      files: [
        {
          path: "README.md",
          content:
            "# Team Files\n\nA shared Drive for plain files — onboarding docs, policies, and reference sheets the whole team pulls from. Propose edits through change requests before merge.\n\n## Contents\n\n- `onboarding/first-week.md` — what a new hire does in week one\n- `policy/expense-approval.md` — who approves what, and at what amount\n- `reference/team-roster.csv` — who's on the team and what they own\n",
        },
        {
          path: "onboarding/first-week.md",
          content:
            "# First week checklist\n\n## Day 1\n\n- Get access to Busabase, the shared inbox, and the team calendar.\n- Read the Agent Operating Guide (Docs) — it's how every change gets reviewed here.\n- Meet your onboarding buddy for a 30-minute walkthrough.\n\n## Day 2-3\n\n- Shadow a review: watch a teammate approve or request changes on a real change request.\n- Open your first change request — even a small doc fix counts. The goal is to feel the propose → review → merge loop once before it matters.\n\n## Day 4-5\n\n- Pick up one small task from the backlog with your onboarding buddy as reviewer.\n- Set up your notification preferences so review requests actually reach you.\n\n## By the end of week one\n\nYou should have had at least one change request approved and merged, and reviewed at least one teammate's change.\n",
        },
        {
          path: "policy/expense-approval.md",
          content:
            "# Expense approval policy\n\n| Amount | Approver |\n| --- | --- |\n| Under $100 | Self-approve, just log it |\n| $100 - $1,000 | Team lead |\n| $1,000 - $10,000 | Department head |\n| Over $10,000 | Finance + department head |\n\n## Submitting\n\nOpen a change request against the Invoices base with the receipt attached. Approval happens the same way as any other change here — reviewed, then merged.\n\n## Reimbursement timing\n\nApproved expenses are paid out in the next payroll cycle after merge, not immediately — budget 1-2 weeks.\n",
        },
        {
          path: "reference/team-roster.csv",
          content:
            "name,role,team,started\nAlex Rivera,Engineering Lead,Platform,2024-03-11\nJordan Lee,Product Manager,Platform,2024-06-02\nSam Okafor,Support Engineer,Support,2024-09-15\nPriya Nair,Designer,Design,2025-01-20\nCasey Morgan,DevOps Engineer,Platform,2025-04-07\n",
        },
      ],
    },
    {
      nodeType: "airapp",
      nodeId: "nod_airapp_hono_api_demo",
      slug: AIRAPP_DEMO_HONO_API.slug,
      name: AIRAPP_DEMO_HONO_API.name,
      description: AIRAPP_DEMO_HONO_API.description,
      position: 0,
      files: AIRAPP_DEMO_HONO_API.files,
    },
    {
      nodeType: "airapp",
      nodeId: "nod_airapp_sqlite_demo",
      slug: AIRAPP_DEMO_SQLITE.slug,
      name: AIRAPP_DEMO_SQLITE.name,
      description: AIRAPP_DEMO_SQLITE.description,
      position: 1,
      files: AIRAPP_DEMO_SQLITE.files,
    },
  ],
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
