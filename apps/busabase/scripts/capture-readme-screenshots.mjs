// Capture README screenshots from the live demo dashboard.
// Usage: pnpm --filter busabase dev (port 15419) running, then `node scripts/capture-readme-screenshots.mjs`

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "public", "assets", "readme");
// Main grid shots are captured raw here, then wrapped in macOS-window chrome by
// generate-window-frames.mjs (which writes the framed PNGs back into OUT under
// the same filename). Run that script after capturing.
const RAW_OUT = path.join(OUT, "desktop-raw");
const BASE = process.env.BUSABASE_URL || "http://localhost:15419";

// Locale to capture. "en" (default) writes to scenarios/; any other locale
// appends &lang=<LANG> to the demo URLs and writes to scenarios/<LANG>/.
const LANG = process.env.CAPTURE_LANG || "en";
const langParam = LANG === "en" ? "" : `&lang=${LANG}`;

// English scenario shots capture raw into scenarios-raw/, then get wrapped in
// macOS-window chrome by generate-window-frames.mjs (written back to scenarios/).
const SCENARIO_OUT =
  LANG === "en" ? path.join(OUT, "scenarios-raw") : path.join(OUT, "scenarios", LANG);

const scenarioShots = [
  {
    key: "field-types",
    demo: "field-types",
    base: "field-type-lab",
    cr: "crq_seed_field_type_lab_update",
    record: "rec_seed_field_type_lab",
    cells: [
      {
        kind: "base",
        label: "Field Type Lab",
        waitFor: "text=Field Type Lab",
      },
      {
        kind: "inbox",
        label: "Field type review",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "All-field diff",
        waitFor: "text=field-type-agent",
      },
      {
        kind: "record",
        label: "All-field record",
        waitFor: "text=All field types coverage",
      },
    ],
  },
  {
    key: "canonical",
    demo: "canonical",
    base: "blog",
    cr: "crq_seed_blog_update",
    record: "rec_seed_blog_approval",
    cells: [
      {
        kind: "base",
        label: "Canonical records",
        waitFor: "text=Blog Posts",
      },
      {
        kind: "inbox",
        label: "Proposal queue",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "Review diff",
        waitFor: "text=analysis-agent",
      },
      {
        kind: "record",
        label: "Lineage trail",
        waitFor: "text=Review history",
      },
    ],
  },
  {
    key: "blog-cms",
    demo: "blog",
    base: "blog",
    cr: "crq_seed_blog_update",
    record: "rec_seed_blog_approval",
    cells: [
      {
        kind: "base",
        label: "Blog base",
        waitFor: "text=Blog Posts",
      },
      {
        kind: "inbox",
        label: "Draft proposal",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "Editorial review",
        waitFor: "text=ai-research-agent",
      },
      {
        kind: "record",
        label: "Published record",
        waitFor: "text=Review history",
      },
    ],
  },
  {
    key: "training-datasets",
    demo: "dataset",
    base: "qa-training-dataset",
    cr: "crq_seed_training_quality_score",
    record: "rec_seed_training_refusal_eval",
    cells: [
      {
        kind: "base",
        label: "Dataset base",
        waitFor: "text=QA Training Dataset",
      },
      {
        kind: "inbox",
        label: "Agent labels",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "Quality review",
        waitFor: "text=eval-curation-agent",
      },
      {
        kind: "record",
        label: "Review history",
        waitFor: "text=Review history",
      },
    ],
  },
  {
    key: "multimodal-review",
    demo: "media",
    base: "media-assets",
    cr: "crq_seed_media_metadata",
    record: "rec_seed_media_clip_review",
    cells: [
      {
        kind: "base",
        label: "Media base",
        waitFor: "text=Media Assets",
      },
      {
        kind: "inbox",
        label: "Metadata proposal",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "Safety review",
        waitFor: "text=media-metadata-agent",
      },
      {
        kind: "record",
        label: "Approved asset",
        waitFor: "text=Review history",
      },
    ],
  },
  {
    key: "personal-knowledge",
    demo: "knowledge",
    base: "private-knowledge",
    cr: "crq_seed_private_knowledge_enrich",
    record: "rec_seed_private_knowledge_note",
    cells: [
      {
        kind: "base",
        label: "Private knowledge",
        waitFor: "text=Private Knowledge",
      },
      {
        kind: "inbox",
        label: "Local agent proposal",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "Human review",
        waitFor: "text=local-research-agent",
      },
      {
        kind: "record",
        label: "Local audit",
        waitFor: "text=Review history",
      },
    ],
  },
  {
    key: "operations-erp",
    demo: "operations",
    base: "ops-tasks",
    cr: "crq_seed_ops_status_reconcile",
    record: "rec_seed_ops_vendor_onboarding",
    cells: [
      {
        kind: "base",
        label: "Operations base",
        waitFor: "text=Ops Tasks",
      },
      {
        kind: "inbox",
        label: "Status proposal",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "Manager review",
        waitFor: "text=ops-reconcile-agent",
      },
      {
        kind: "record",
        label: "Trusted operations",
        waitFor: "text=Review history",
      },
    ],
  },
  {
    key: "routine-work",
    demo: "routine",
    base: "routine-work-log",
    cr: "crq_seed_routine_support_qa",
    record: "rec_seed_routine_support_qa",
    cells: [
      {
        kind: "base",
        label: "Routine task log",
        waitFor: "text=Routine Work Log",
      },
      {
        kind: "inbox",
        label: "Agent work result",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "Reviewer decision",
        waitFor: "text=support-qa-agent",
      },
      {
        kind: "record",
        label: "Trusted log",
        waitFor: "text=Review history",
      },
    ],
  },
  {
    key: "crm-hygiene",
    demo: "crm",
    base: "companies",
    cr: "crq_seed_crm_company_enrich",
    record: "rec_seed_crm_company_acme",
    cells: [
      {
        kind: "base",
        label: "CRM records",
        waitFor: "text=Companies",
      },
      {
        kind: "inbox",
        label: "Hygiene proposal",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "Data steward review",
        waitFor: "text=crm-hygiene-agent",
      },
      {
        kind: "record",
        label: "Clean CRM record",
        waitFor: "text=Review history",
      },
    ],
  },
  {
    key: "finance-review",
    demo: "finance",
    base: "invoices",
    cr: "crq_seed_invoice_three_way_match",
    record: "rec_seed_invoice_globex_cloud",
    cells: [
      {
        kind: "base",
        label: "Finance records",
        waitFor: "text=Invoices",
      },
      {
        kind: "inbox",
        label: "Match proposal",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "Finance review",
        waitFor: "text=ap-reconcile-agent",
      },
      {
        kind: "record",
        label: "Reconciliation trail",
        waitFor: "text=Review history",
      },
    ],
  },
  {
    key: "compliance-checklists",
    demo: "compliance",
    base: "compliance-checklists",
    cr: "crq_seed_compliance_evidence",
    record: "rec_seed_compliance_access_review",
    cells: [
      {
        kind: "base",
        label: "Checklist base",
        waitFor: "text=Compliance Checklists",
      },
      {
        kind: "inbox",
        label: "Evidence proposal",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "Evidence review",
        waitFor: "text=compliance-evidence-agent",
      },
      {
        kind: "record",
        label: "Audit events",
        waitFor: "text=Review history",
      },
    ],
  },
  {
    key: "market-research",
    demo: "research",
    base: "market-research",
    cr: "crq_seed_research_signal",
    record: "rec_seed_research_competitor_pricing",
    cells: [
      {
        kind: "base",
        label: "Research feed",
        waitFor: "text=Market Research",
      },
      {
        kind: "inbox",
        label: "Finding proposal",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "Analyst review",
        waitFor: "text=market-intel-agent",
      },
      {
        kind: "record",
        label: "Approved insight",
        waitFor: "text=Review history",
      },
    ],
  },
  {
    key: "content-factory",
    demo: "content",
    base: "content-pipeline",
    cr: "crq_seed_content_brief_update",
    record: "rec_seed_content_launch_brief",
    cells: [
      {
        kind: "base",
        label: "Content pipeline",
        waitFor: "text=Content Pipeline",
      },
      {
        kind: "inbox",
        label: "Creative proposal",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "Editor review",
        waitFor: "text=content-ops-agent",
      },
      {
        kind: "record",
        label: "Publish-ready record",
        waitFor: "text=Review history",
      },
    ],
  },
  {
    key: "dataset-labeling",
    demo: "labeling",
    base: "labeling-queue",
    cr: "crq_seed_labeling_correction",
    record: "rec_seed_labeling_clip_scene",
    cells: [
      {
        kind: "base",
        label: "Labeling queue",
        waitFor: "text=Labeling Queue",
      },
      {
        kind: "inbox",
        label: "Pre-label proposal",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "Human correction",
        waitFor: "text=labeling-agent",
      },
      {
        kind: "record",
        label: "Approved labels",
        waitFor: "text=Review history",
      },
    ],
  },
  {
    key: "seo-pages",
    demo: "seo-pages",
    base: "pages",
    cr: "crq_seed_seo_page_draft",
    record: "rec_seed_seo_vs_notion",
    cells: [
      {
        kind: "base",
        label: "Pages base",
        waitFor: "text=Pages",
      },
      {
        kind: "inbox",
        label: "Draft page proposal",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "HTML diff review",
        waitFor: "text=seo-agent",
      },
      {
        kind: "record",
        label: "Live landing page",
        waitFor: "text=Busabase vs Notion",
      },
    ],
  },
  {
    key: "config-mgmt",
    demo: "config-mgmt",
    base: "services",
    cr: "crq_seed_config_rate_limit",
    record: "rec_seed_config_api_gateway",
    cells: [
      {
        kind: "base",
        label: "Services base",
        waitFor: "text=Services",
      },
      {
        kind: "inbox",
        label: "Rate limit proposal",
        waitFor: "text=For review",
      },
      {
        kind: "review",
        label: "YAML diff review",
        waitFor: "text=config-agent",
      },
      {
        kind: "record",
        label: "api-gateway record",
        waitFor: "text=api-gateway",
      },
    ],
  },
];

const routeForScenarioShot = (scenario, kind) => {
  const suffix = `?demo=${scenario.demo}${langParam}`;
  if (kind === "base") {
    return `${BASE}/dashboard/base/${scenario.base}${suffix}`;
  }
  if (kind === "inbox") {
    return `${BASE}/dashboard/inbox${suffix}`;
  }
  if (kind === "review") {
    return `${BASE}/dashboard/inbox/${scenario.cr}${suffix}`;
  }
  return `${BASE}/dashboard/base/${scenario.base}/${scenario.record}${suffix}`;
};

// Each shot loads a FULL url with ?demo so the proxy keeps demo mode on
// (client-side wouter navigation would drop the query and end the demo).
// Top-level shots are English-only; the homepage uses scenarios/<lang>/ for i18n.
const shots = [
  {
    file: "busabase-inbox-review.png",
    url: `${BASE}/dashboard/inbox?demo=1`,
    waitFor: "text=For review",
  },
  {
    file: "busabase-agent-output-preview.png",
    url: `${BASE}/dashboard/inbox/crq_seed_blog_update?demo=1`,
    waitFor: "text=What will change",
  },
  {
    file: "busabase-record-detail-audit.png",
    url: `${BASE}/dashboard/base/blog/rec_seed_blog_approval?demo=1`,
    waitFor: "text=AI agents are moving from demos into operator workflows",
  },
  {
    file: "busabase-base-table.png",
    url: `${BASE}/dashboard/base/blog?demo=1`,
    waitFor: "text=Blog Posts",
  },
  {
    // Rich base with image thumbnails — labeling queue shows asset column
    file: "busabase-base-records.png",
    url: `${BASE}/dashboard/base/labeling-queue?demo=labeling`,
    waitFor: "text=Labeling Queue",
  },
  {
    file: "busabase-graph-view.png",
    url: `${BASE}/dashboard/graph?demo=1`,
    waitFor: "text=Graph View",
  },
  {
    // Deduped global asset library (DAM) — illustrates Attachments & Assets
    file: "busabase-assets.png",
    url: `${BASE}/dashboard/assets?demo=1`,
    waitFor: "text=Assets",
  },
  {
    // Workspace activity feed — illustrates Events / audit history
    file: "busabase-activity.png",
    url: `${BASE}/dashboard/activity?demo=1`,
    waitFor: "text=Workspace activity",
  },
];

// The "Agent Integration" dialog (sidebar footer → "Agent Skills") is a modal,
// not a route. It carries three tabs we screenshot for the Developers / AI docs:
// Agent Skills (SKILL.md prompt), MCP (HTTP/SSE endpoints), OpenAPI (spec + docs).
const dialogShots = [
  { tab: "Agent Skills", file: "busabase-agent-skills.png" },
  { tab: "MCP", file: "busabase-mcp.png" },
  { tab: "OpenAPI", file: "busabase-openapi.png" },
];

await fs.promises.mkdir(SCENARIO_OUT, { recursive: true });
await fs.promises.mkdir(RAW_OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

for (const shot of LANG === "en" ? shots : []) {
  await page.goto(shot.url, { waitUntil: "networkidle" });
  try {
    await page.waitForSelector(shot.waitFor, { timeout: 5000 });
  } catch {
    console.warn(`! waitFor missed for ${shot.file}: ${shot.waitFor}`);
  }
  await page.waitForTimeout(1000);
  const out = path.join(RAW_OUT, shot.file);
  await page.screenshot({ path: out });
  console.log(`✓ desktop-raw/${shot.file}`);
}

// Agent Integration dialog tabs (English-only; the demo dialog is not localized).
if (LANG === "en") {
  await page.goto(`${BASE}/dashboard/inbox?demo=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  // Open the dialog from the sidebar footer button (before it opens, the only
  // "Agent Skills" text is the sidebar button — not yet the in-dialog tab).
  await page.getByText("Agent Skills", { exact: true }).first().click();
  try {
    await page.waitForSelector("text=Agent Integration", { timeout: 5000 });
  } catch {
    console.warn("! Agent Integration dialog did not open");
  }
  for (const { tab, file } of dialogShots) {
    await page.getByRole("tab", { name: new RegExp(`^${tab}$`, "i") }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, file) });
    console.log(`✓ ${file}`);
  }
}

for (const scenario of scenarioShots) {
  for (const cell of scenario.cells) {
    const file = `${scenario.key}-${cell.kind}.png`;
    const url = routeForScenarioShot(scenario, cell.kind);
    await page.goto(url, { waitUntil: "networkidle" });
    // review pages show the CR author as a title-cased display name, not the
    // raw "<x>-agent" handle — wait on the stable "What will change" heading.
    const waitFor = cell.kind === "review" ? "text=What will change" : cell.waitFor;
    try {
      await page.waitForSelector(waitFor, { timeout: 5000 });
    } catch {
      console.warn(`! waitFor missed for ${file}: ${waitFor}`);
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SCENARIO_OUT, file) });
    console.log(`✓ scenarios/${file}`);
  }
}

await browser.close();
console.log("done");
