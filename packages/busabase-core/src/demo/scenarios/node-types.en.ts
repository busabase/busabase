import {
  AIRAPP_DEMO_COMPLIANCE_BOARD,
  AIRAPP_DEMO_DEAL_PIPELINE,
  AIRAPP_DEMO_HONO_API,
  AIRAPP_DEMO_PURE_HTML,
  AIRAPP_DEMO_SQLITE,
} from "../../domains/airapp/demo-content";
import type { SeedScenario } from "../seed-types";

// English per-node-type example content: Skills + Drives + AirApps + Docs + Files +
// review Comments. Shipped via `pnpm db:seed:all`, on top of the scenario's
// folders/bases/records. The zh-CN counterpart (`node-types.zh-cn.ts`) mirrors this
// structure with different data — AirApps are English-only for now (see the
// whiteboard-node changelog for why).
//
// AirApp content comes from `domains/airapp/demo-content` — the same catalog
// `apps/busabase/scripts/demo/14-airapps.ts` uses to create all 10 demos via
// the REST API, so the two never drift. Only the fast, dependency-light demos
// (Pure HTML, Hono API, SQLite, Deal Pipeline Board, Compliance Status Board —
// all zero npm dependencies) are seeded here; the Vite-based ones (slower
// installs, two of them deliberately broken) are left out of this fast
// baseline seed. Deal Pipeline Board / Compliance Status Board read the
// `deals` / `compliance-checklists` Bases live at Run-time via the
// `/__busabase_api__/` bridge (see `demo-content.ts`'s docblock) — those
// Bases come from a different scenario (`cross-functional.ts`) in this same
// `db:seed:all` pipeline, but since the read happens at Run-time rather than
// seed-time, scenario ordering between the two doesn't matter.

const DOC_GUIDE_CR_ID = "crq_seed_doc_operating_guide";
const RICH_NODES_FOLDER_ID = "nod_visual_tools";

// ── Skill: AI Research Editor ────────────────────────────────────────────────
// Same content that used to be hardcoded directly in seed.ts's
// `seedSkillNodeIfMissing` — moved here verbatim so it's scenario-driven instead.

const AI_RESEARCH_EDITOR_SKILL_MD = `---\nname: ai-research-editor\ndescription: Reviews agent research drafts for source quality before publishing.\n---\n\n# AI Research Editor\n\nUse this skill when an agent proposes AI industry analysis, newsletter copy, or social threads that need source checks before merge.\n\n## Workflow\n\n1. Read the proposed ChangeRequest operations.\n2. Check whether every factual claim has a source URL or a clear internal record reference.\n3. Flag unsupported claims before approval.\n4. Keep edits concise and preserve the author's thesis.\n`;

export const enNodeTypesScenario: SeedScenario = {
  folders: [
    {
      nodeId: RICH_NODES_FOLDER_ID,
      slug: "visual-tools",
      name: "Visual Tools",
      description: "Whiteboards, executable process designs, mind maps, and HTML prototypes.",
      position: 6,
    },
  ],
  richNodes: [
    {
      nodeType: "whiteboard",
      nodeId: "nod_whiteboard_product_launch",
      folderNodeId: RICH_NODES_FOLDER_ID,
      slug: "product-launch-whiteboard",
      name: "Product Launch Whiteboard",
      description: "A free-form launch workspace with goals, owners, and open questions.",
      position: 0,
      metadata: {
        whiteboardDocument: {
          version: 1,
          appState: { viewBackgroundColor: "#f8fafc" },
          elements: [
            {
              id: "launch-title",
              type: "text",
              x: 80,
              y: 50,
              width: 330,
              height: 38,
              angle: 0,
              strokeColor: "#0f172a",
              backgroundColor: "transparent",
              fillStyle: "solid",
              strokeWidth: 1,
              strokeStyle: "solid",
              roughness: 1,
              opacity: 100,
              groupIds: [],
              frameId: null,
              index: "a0",
              roundness: null,
              seed: 101,
              version: 1,
              versionNonce: 101,
              isDeleted: false,
              boundElements: null,
              updated: 1,
              link: null,
              locked: false,
              text: "Product launch whiteboard",
              fontSize: 28,
              fontFamily: 5,
              textAlign: "left",
              verticalAlign: "top",
              containerId: null,
              originalText: "Product launch whiteboard",
              autoResize: true,
              lineHeight: 1.25,
            },
            ...[
              ["goal", 80, 130, "Goal\nApproval-first launch", "#dcfce7", 102],
              ["owners", 400, 130, "Owners\nProduct · Growth · Support", "#dbeafe", 103],
              ["risks", 80, 330, "Open questions\nPricing · onboarding · launch", "#fef3c7", 104],
              [
                "success",
                400,
                330,
                "Success signals\nActivation · approvals · reuse",
                "#fce7f3",
                105,
              ],
            ].flatMap(([id, x, y, text, color, seed], index) => [
              {
                id: `${id}-box`,
                type: "rectangle",
                x,
                y,
                width: 250,
                height: 125,
                angle: 0,
                strokeColor: "#475569",
                backgroundColor: color,
                fillStyle: "solid",
                strokeWidth: 2,
                strokeStyle: "solid",
                roughness: 1,
                opacity: 100,
                groupIds: [],
                frameId: null,
                index: `a${index * 2 + 1}`,
                roundness: { type: 3 },
                seed,
                version: 1,
                versionNonce: seed,
                isDeleted: false,
                boundElements: null,
                updated: 1,
                link: null,
                locked: false,
              },
              {
                id: `${id}-text`,
                type: "text",
                x: Number(x) + 15,
                y: Number(y) + 24,
                width: 220,
                height: 60,
                angle: 0,
                strokeColor: "#0f172a",
                backgroundColor: "transparent",
                fillStyle: "solid",
                strokeWidth: 1,
                strokeStyle: "solid",
                roughness: 1,
                opacity: 100,
                groupIds: [],
                frameId: null,
                index: `a${index * 2 + 2}`,
                roundness: null,
                seed: Number(seed) + 10,
                version: 1,
                versionNonce: Number(seed) + 10,
                isDeleted: false,
                boundElements: null,
                updated: 1,
                link: null,
                locked: false,
                text,
                fontSize: 16,
                fontFamily: 5,
                textAlign: "left",
                verticalAlign: "top",
                containerId: null,
                originalText: text,
                autoResize: true,
                lineHeight: 1.35,
              },
            ]),
          ],
        },
      },
    },
    {
      nodeType: "workflow",
      nodeId: "nod_workflow_lead_intake",
      folderNodeId: RICH_NODES_FOLDER_ID,
      slug: "lead-intake-workflow",
      name: "Lead Intake Workflow",
      description: "A standardized webhook-to-review flow for new qualified leads.",
      position: 1,
      metadata: {
        workflowDocument: {
          version: 2,
          nodes: [
            {
              id: "new-lead",
              kind: "trigger",
              position: { x: 0, y: 80 },
              label: "New lead",
              description: "Start when a lead form is submitted.",
              eventName: "lead.submitted",
            },
            {
              id: "enrich",
              kind: "webhook",
              position: { x: 280, y: 80 },
              label: "Enrich company",
              description: "Send the lead to the enrichment webhook.",
              method: "POST",
              url: "https://example.com/webhooks/enrich-company",
            },
            {
              id: "score",
              kind: "function",
              position: { x: 560, y: 80 },
              label: "Score fit",
              description: "Calculate ICP fit from the enriched profile.",
              webhookRuleId: "",
              functionName: "scoreLeadFit",
            },
            {
              id: "review",
              kind: "condition",
              position: { x: 840, y: 80 },
              label: "Qualified lead?",
              description: "Branch using the score returned by the function.",
              expression: "input.score >= 80",
            },
            {
              id: "approval",
              kind: "approval",
              position: { x: 840, y: 260 },
              label: "Approve outreach",
              description: "Require a space admin to approve qualified-lead outreach.",
              approver: "space-admin",
            },
            {
              id: "wait",
              kind: "wait",
              position: { x: 560, y: 260 },
              label: "Wait for CRM sync",
              description: "Allow enrichment and CRM projections to settle.",
              duration: 30,
              unit: "minutes",
            },
            {
              id: "create-review",
              kind: "action",
              position: { x: 280, y: 260 },
              label: "Create review task",
              description: "Create a review ChangeRequest for the account owner.",
              actionName: "createChangeRequest",
            },
            {
              id: "completed",
              kind: "end",
              position: { x: 0, y: 260 },
              label: "Ready for outreach",
              description: "The qualified lead completed the standardized flow.",
              outcome: "approved",
            },
            {
              id: "not-qualified",
              kind: "end",
              position: { x: 840, y: -180 },
              label: "Archive lead",
              description: "The lead does not meet the current qualification threshold.",
              outcome: "not-qualified",
            },
          ],
          edges: [
            {
              id: "lead-enrich",
              source: "new-lead",
              target: "enrich",
              label: "",
              outcome: "default",
            },
            {
              id: "enrich-score",
              source: "enrich",
              target: "score",
              label: "enriched",
              outcome: "success",
            },
            {
              id: "score-review",
              source: "score",
              target: "review",
              label: "scored",
              outcome: "success",
            },
            {
              id: "review-approval",
              source: "review",
              target: "approval",
              label: "qualified",
              outcome: "true",
            },
            {
              id: "review-archive",
              source: "review",
              target: "not-qualified",
              label: "not qualified",
              outcome: "false",
            },
            {
              id: "approval-wait",
              source: "approval",
              target: "wait",
              label: "approved",
              outcome: "approved",
            },
            {
              id: "wait-action",
              source: "wait",
              target: "create-review",
              label: "ready",
              outcome: "elapsed",
            },
            {
              id: "action-complete",
              source: "create-review",
              target: "completed",
              label: "created",
              outcome: "success",
            },
          ],
          settings: {
            executionMode: "event",
            concurrency: 4,
            timeoutMs: 60000,
            errorPolicy: "stop",
          },
        },
      },
    },
    {
      nodeType: "html",
      nodeId: "nod_html_waitlist_form",
      folderNodeId: RICH_NODES_FOLDER_ID,
      slug: "waitlist-form-prototype",
      name: "Waitlist Form Prototype",
      description: "An editable HTML prototype for a compact waitlist intake form.",
      position: 2,
      metadata: {
        htmlDocument: {
          version: 1,
          source: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Join the Busabase waitlist</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px; background: #f1f5f9; color: #0f172a; font: 16px/1.5 system-ui, sans-serif; }
    main { width: min(100%, 520px); border: 1px solid #cbd5e1; border-radius: 12px; background: white; padding: 32px; box-shadow: 0 18px 45px rgba(15, 23, 42, .08); }
    p { color: #475569; }
    label { display: grid; gap: 6px; margin-top: 18px; font-weight: 600; }
    input, select, button { width: 100%; min-height: 44px; border-radius: 7px; font: inherit; }
    input, select { border: 1px solid #94a3b8; padding: 0 12px; }
    button { margin-top: 24px; border: 0; background: #166534; color: white; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>Build trusted agent workflows</h1>
    <p>Tell us what you want to review before an agent's output becomes canonical.</p>
    <form onsubmit="event.preventDefault(); this.querySelector('button').textContent='You are on the list';">
      <label>Work email <input type="email" placeholder="you@company.com" required></label>
      <label>Primary use case <select><option>Agent knowledge base</option><option>Content operations</option><option>Data review</option></select></label>
      <button type="submit">Request early access</button>
    </form>
  </main>
</body>
</html>`,
        },
      },
    },
  ],
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
      nodeId: "nod_airapp_pure_html_demo",
      slug: AIRAPP_DEMO_PURE_HTML.slug,
      name: AIRAPP_DEMO_PURE_HTML.name,
      description: AIRAPP_DEMO_PURE_HTML.description,
      position: 0,
      files: AIRAPP_DEMO_PURE_HTML.files,
    },
    {
      nodeType: "airapp",
      nodeId: "nod_airapp_hono_api_demo",
      slug: AIRAPP_DEMO_HONO_API.slug,
      name: AIRAPP_DEMO_HONO_API.name,
      description: AIRAPP_DEMO_HONO_API.description,
      position: 1,
      files: AIRAPP_DEMO_HONO_API.files,
    },
    {
      nodeType: "airapp",
      nodeId: "nod_airapp_sqlite_demo",
      slug: AIRAPP_DEMO_SQLITE.slug,
      name: AIRAPP_DEMO_SQLITE.name,
      description: AIRAPP_DEMO_SQLITE.description,
      position: 2,
      files: AIRAPP_DEMO_SQLITE.files,
    },
    {
      nodeType: "airapp",
      nodeId: "nod_airapp_deal_pipeline_demo",
      slug: AIRAPP_DEMO_DEAL_PIPELINE.slug,
      name: AIRAPP_DEMO_DEAL_PIPELINE.name,
      description: AIRAPP_DEMO_DEAL_PIPELINE.description,
      position: 3,
      files: AIRAPP_DEMO_DEAL_PIPELINE.files,
    },
    {
      nodeType: "airapp",
      nodeId: "nod_airapp_compliance_board_demo",
      slug: AIRAPP_DEMO_COMPLIANCE_BOARD.slug,
      name: AIRAPP_DEMO_COMPLIANCE_BOARD.name,
      description: AIRAPP_DEMO_COMPLIANCE_BOARD.description,
      position: 4,
      files: AIRAPP_DEMO_COMPLIANCE_BOARD.files,
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
