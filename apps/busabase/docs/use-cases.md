# Use Cases

[← Back to the README](../README.md)

Concrete things people build on Busabase — the same review-first workflow applied to different kinds of data and content.

**Contents**

- [Blog CMS for Next.js](#blog-cms-for-nextjs)
- [SEO Landing Pages](#seo-landing-pages)
- [Configuration Management](#configuration-management)
- [Finance and Invoice Review](#finance-and-invoice-review)
- [Data Stewardship and CRM Hygiene](#data-stewardship-and-crm-hygiene)
- [Compliance and Audit Checklists](#compliance-and-audit-checklists)
- [High-Quality QA and Training Datasets](#high-quality-qa-and-training-datasets)
- [Multimodal Content Review](#multimodal-content-review)
- [Market Intelligence and Research Monitoring](#market-intelligence-and-research-monitoring)
- [Content Factory Pipeline](#content-factory-pipeline)
- [Dataset Labeling Pipeline](#dataset-labeling-pipeline)
- [Approval-Based Project Management and ERP](#approval-based-project-management-and-erp)
- [Canonical System of Record](#canonical-system-of-record)
- [Local Personal Knowledge Base](#local-personal-knowledge-base)
- [Verified Routine Work](#verified-routine-work)
- [Field Type Lab](#field-type-lab)

### Blog CMS for Next.js

Use Busabase as a local CMS for a blog or editorial workflow.

Create a `Blog` base with fields like:

| Field | Type |
| --- | --- |
| Title | text |
| Slug | text |
| Body | markdown |
| HTML Preview | html |
| Tags | multiselect |
| Publish Date | date |
| Status | select |

Then your flow becomes:

1. AI or a writer creates a Markdown post.
2. The post enters Busabase as a Change Request.
3. A reviewer checks the content, metadata, and links.
4. The approved post is merged into the trusted base.
5. A Next.js app reads the Busabase API and renders the blog.

Screenshots (capture with `?demo=blog`):

| Blog base | Draft proposal |
| --- | --- |
| ![Blog Posts base with title, slug, status, tags, and publish date fields](../public/assets/readme/scenarios/blog-cms-base.png) | ![Agent or writer submits a Markdown post as a Change Request](../public/assets/readme/scenarios/blog-cms-inbox.png) |
| Blog Posts base with title, slug, status, tags, and publish date fields | Agent or writer submits a Markdown post as a Change Request |
| ![Reviewer checks body, metadata, links, and HTML preview](../public/assets/readme/scenarios/blog-cms-review.png) | ![Approved post appears as a trusted record for the Next.js app](../public/assets/readme/scenarios/blog-cms-record.png) |
| Reviewer checks body, metadata, links, and HTML preview | Approved post appears as a trusted record for the Next.js app |

### SEO Landing Pages

Use Busabase to manage and review AI-generated HTML landing pages before they go live.

Create an `SEO` folder containing a `Pages` base with fields like:

| Field | Type | Purpose |
| --- | --- | --- |
| Slug | text | URL path, e.g. `/pricing` or `/vs-notion` |
| Title | text | `<title>` tag value |
| Meta Description | text | `<meta name="description">` content |
| Target Keywords | text | Primary keyword(s) the page targets |
| HTML Body | html | Full page HTML — embedded directly by Next.js |
| Status | select | Draft, In Review, Live, Archived |
| Page Score | number | SEO or conversion quality score from the reviewer |
| Notes | text | Reviewer notes on copy, structure, or accuracy |

Then your flow becomes:

1. An AI agent generates a complete HTML landing page for a keyword or product comparison.
2. The page enters Busabase as a Change Request in the `Pages` base.
3. A reviewer checks HTML structure, copy quality, meta tags, and keyword targeting.
4. The reviewer approves or asks the agent to revise.
5. The approved record is merged into the trusted base.
6. A Next.js route reads the Busabase API by slug and renders the `html` field directly:

```tsx
// app/lp/[slug]/page.tsx
export default async function LandingPage({ params }: { params: { slug: string } }) {
  const record = await busabase.records.find({ baseSlug: "pages", slug: params.slug });
  return <div dangerouslySetInnerHTML={{ __html: record.fields.html_body }} />;
}
```

This makes it practical to maintain dozens or hundreds of high-quality SEO pages with full human oversight over what gets published, and a clear revision history for every page.

Screenshots (capture with `?demo=seo-pages`):

| Pages base | Draft proposal |
| :---: | :---: |
| ![SEO Pages base with slug, title, meta description, target keywords, and HTML body fields](../public/assets/readme/scenarios/seo-pages-base.png) | ![Agent proposes a complete HTML landing page as a Change Request](../public/assets/readme/scenarios/seo-pages-inbox.png) |
| SEO Pages base with slug, title, meta description, target keywords, and HTML body | Agent proposes a complete HTML landing page as a Change Request |
| ![Reviewer checks HTML quality, copy, meta tags, and keyword targeting](../public/assets/readme/scenarios/seo-pages-review.png) | ![Approved page record — Next.js reads the html field and renders a live landing page](../public/assets/readme/scenarios/seo-pages-record.png) |
| Reviewer checks HTML quality, copy, meta tags, and keyword targeting | Approved page record — Next.js renders it as a live landing page |

### Configuration Management

Use Busabase to store and version service configurations as YAML and JSON. An AI agent proposes config changes — rate limit increases, feature flags, environment overrides — as Change Requests. The team reviews the exact diff before anything reaches production.

The new **Code field type** (supporting JSON, YAML, TypeScript, SQL, Bash, and more) renders configurations with full syntax highlighting directly in the table, the record detail view, and the review diff.

Example base:

| Field | Type | Purpose |
| --- | --- | --- |
| Service | Text | Service name (e.g. `api-gateway`) |
| Environment | Select | `development` / `staging` / `production` |
| Config (YAML) | Code — yaml | Main configuration file |
| Overrides (JSON) | Code — json | Runtime environment variable overrides |
| Status | Select | `active` / `degraded` / `maintenance` |
| Deployed At | Date | Last successful deploy date |
| Notes | Long Text | Context for the current config |

When `config-agent` detects traffic projections require a rate limit change, it creates a Change Request showing the exact YAML diff. The reviewer sees highlighted `before` and `after` values side-by-side and approves or requests changes — no guesswork about what changed.

```tsx
// Next.js: read a config record and apply it at startup
const config = await busabase.records.find({ baseSlug: "services", name: "api-gateway" });
const parsed = yaml.parse(config.fields.config);
applyRateLimit(parsed.rate_limit.requests_per_minute);
```

Screenshots (capture with `?demo=config-mgmt`):

| Services base | Rate limit proposal |
| :---: | :---: |
| ![Services base showing YAML and JSON code fields with syntax highlighting](../public/assets/readme/scenarios/config-mgmt-base.png) | ![config-agent proposes a rate limit increase as a Change Request](../public/assets/readme/scenarios/config-mgmt-inbox.png) |
| Services base with YAML and JSON code fields | config-agent proposes a rate limit increase |
| ![Reviewer sees the exact YAML diff with syntax highlighting](../public/assets/readme/scenarios/config-mgmt-review.png) | ![api-gateway record with highlighted config field](../public/assets/readme/scenarios/config-mgmt-record.png) |
| Reviewer sees the exact YAML diff highlighted | api-gateway record with syntax-highlighted config |

### Finance and Invoice Review

Use Busabase for finance workflows where automation helps, but trust still matters.

An agent can read invoices, orders, receipts, and payment records, then propose matched records for review. A finance teammate can approve the match, reject suspicious rows, or ask the agent to explain a mismatch.

This works well for:

- invoice reconciliation
- expense review
- order-to-payment matching
- renewal checks
- vendor record cleanup

Screenshots (capture with `?demo=finance`):

| Finance records | Match proposal |
| --- | --- |
| ![Invoices, orders, receipts, payments, or vendor records in a finance base](../public/assets/readme/scenarios/finance-review-base.png) | ![Agent proposes invoice matching, expense categorization, or renewal cleanup](../public/assets/readme/scenarios/finance-review-inbox.png) |
| Invoices, orders, receipts, payments, or vendor records in a finance base | Agent proposes invoice matching, expense categorization, or renewal cleanup |
| ![Finance reviewer checks mismatches, suspicious rows, and explanation notes](../public/assets/readme/scenarios/finance-review-review.png) | ![Approved reconciliation record with review and audit trail](../public/assets/readme/scenarios/finance-review-record.png) |
| Finance reviewer checks mismatches, suspicious rows, and explanation notes | Approved reconciliation record with review and audit trail |

### Data Stewardship and CRM Hygiene

Use Busabase as a review queue for keeping business data clean.

Agents can scan records for duplicates, stale status, missing fields, inconsistent categories, or incomplete customer profiles. Instead of editing the database directly, they submit Change Requests that a human can review.

Examples:

- merge duplicate companies or contacts
- enrich CRM records with websites, industries, or owner notes
- update lifecycle stages after sales conversations
- normalize tags across messy records
- flag missing consent, contract, or billing information

Screenshots (capture with `?demo=crm`):

| CRM records | Hygiene proposal |
| --- | --- |
| ![Company or contact records with stale, duplicate, or incomplete fields](../public/assets/readme/scenarios/crm-hygiene-base.png) | ![Agent proposes dedupe, enrichment, lifecycle updates, or tag normalization](../public/assets/readme/scenarios/crm-hygiene-inbox.png) |
| Company or contact records with stale, duplicate, or incomplete fields | Agent proposes dedupe, enrichment, lifecycle updates, or tag normalization |
| ![Data steward reviews field-level differences before merge](../public/assets/readme/scenarios/crm-hygiene-review.png) | ![Clean approved CRM record with audit history](../public/assets/readme/scenarios/crm-hygiene-record.png) |
| Data steward reviews field-level differences before merge | Clean approved CRM record with audit history |

### Compliance and Audit Checklists

Use Busabase for recurring checks that need evidence.

Each checklist item can be a record. Each update can be a Change Request. Each approval leaves an audit event.

Examples:

- weekly access reviews
- vendor compliance checks
- policy acknowledgement logs
- data-retention checks
- security exception reviews

Screenshots (capture with `?demo=compliance`):

| Checklist base | Evidence proposal |
| --- | --- |
| ![Access review, vendor compliance, policy, retention, or exception checklist records](../public/assets/readme/scenarios/compliance-checklists-base.png) | ![Agent proposes evidence, status, owner, or due-date updates](../public/assets/readme/scenarios/compliance-checklists-inbox.png) |
| Access review, vendor compliance, policy, retention, or exception checklist records | Agent proposes evidence, status, owner, or due-date updates |
| ![Reviewer validates evidence before approving the checklist item](../public/assets/readme/scenarios/compliance-checklists-review.png) | ![Approved compliance record with immutable audit events](../public/assets/readme/scenarios/compliance-checklists-record.png) |
| Reviewer validates evidence before approving the checklist item | Approved compliance record with immutable audit events |

### High-Quality QA and Training Datasets

Use Busabase to build datasets for model training, evaluation, RAG, and benchmark work.

Example base:

| Field | Purpose |
| --- | --- |
| Question | User input or task |
| Answer | Expected response |
| Source | Where the example came from |
| Domain | Topic or business area |
| Difficulty | Easy, medium, hard |
| Quality Score | Reviewer score |
| Reviewer Notes | Human feedback |

Instead of anonymous CSV edits, every accepted row has a review history.

Screenshots (capture with `?demo=dataset`):

| Dataset base | Agent labels |
| --- | --- |
| ![QA examples table with question, answer, source, difficulty, and quality score](../public/assets/readme/scenarios/training-datasets-base.png) | ![Agent proposes labels, explanations, or corrected answers as a Change Request](../public/assets/readme/scenarios/training-datasets-inbox.png) |
| QA examples table with question, answer, source, difficulty, and quality score | Agent proposes labels, explanations, or corrected answers as a Change Request |
| ![Reviewer scores quality and requests revisions when needed](../public/assets/readme/scenarios/training-datasets-review.png) | ![Approved examples show review history for training or evaluation export](../public/assets/readme/scenarios/training-datasets-record.png) |
| Reviewer scores quality and requests revisions when needed | Approved examples show review history for training or evaluation export |

### Multimodal Content Review

Busabase is designed for more than text.

A `Video Clips` base can include:

| Field | Purpose |
| --- | --- |
| Video | Source video or attachment |
| Transcript | Speech-to-text result |
| Scene Description | Human or AI description |
| Detected Objects | AI-generated labels |
| Tags | Search and routing |
| Usage Rights | Legal or licensing status |
| Review Status | Approval state |

An AI agent can describe the video, extract metadata, and propose tags. A human can approve the record before it enters the final media library, search index, or training corpus.

Screenshots (capture with `?demo=media`):

| Media base | Metadata proposal |
| --- | --- |
| ![Video Clips base with transcript, scene description, detected objects, and usage rights](../public/assets/readme/scenarios/multimodal-review-base.png) | ![Agent proposes tags, captions, scene labels, and rights metadata](../public/assets/readme/scenarios/multimodal-review-inbox.png) |
| Video Clips base with transcript, scene description, detected objects, and usage rights | Agent proposes tags, captions, scene labels, and rights metadata |
| ![Reviewer inspects media fields and approves or rejects unsafe metadata](../public/assets/readme/scenarios/multimodal-review-review.png) | ![Approved clip record is ready for media library, search, or dataset use](../public/assets/readme/scenarios/multimodal-review-record.png) |
| Reviewer inspects media fields and approves or rejects unsafe metadata | Approved clip record is ready for media library, search, or dataset use |

### Market Intelligence and Research Monitoring

Use Busabase as a human-reviewed research feed.

Agents can monitor sources, summarize changes, and propose records. Humans approve the useful findings into a trusted base.

Examples:

- competitor pricing changes
- product launch tracking
- industry news monitoring
- investment research notes
- customer research synthesis

Screenshots (capture with `?demo=research`):

| Research feed | Finding proposal |
| --- | --- |
| ![Market intelligence base with sources, topics, competitors, and importance](../public/assets/readme/scenarios/market-research-base.png) | ![Agent proposes summarized findings from monitored sources](../public/assets/readme/scenarios/market-research-inbox.png) |
| Market intelligence base with sources, topics, competitors, and importance | Agent proposes summarized findings from monitored sources |
| ![Analyst reviews citations, relevance, and confidence before approval](../public/assets/readme/scenarios/market-research-review.png) | ![Approved research record ready for reports, dashboards, or agent memory](../public/assets/readme/scenarios/market-research-record.png) |
| Analyst reviews citations, relevance, and confidence before approval | Approved research record ready for reports, dashboards, or agent memory |

### Content Factory Pipeline

Use Busabase to coordinate content production from idea to published asset.

Each record can represent an idea, outline, draft, image, video, SEO plan, or publishing task. Agents can produce drafts and metadata, while humans approve key transitions.

Examples:

- topic ideation
- draft review
- image or video metadata approval
- SEO title and description review
- publish-ready content records

Screenshots (capture with `?demo=content`):

| Content pipeline | Creative proposal |
| --- | --- |
| ![Ideas, outlines, drafts, assets, SEO plans, and publishing tasks in one base](../public/assets/readme/scenarios/content-factory-base.png) | ![Agent proposes a draft, title, metadata, or asset update](../public/assets/readme/scenarios/content-factory-inbox.png) |
| Ideas, outlines, drafts, assets, SEO plans, and publishing tasks in one base | Agent proposes a draft, title, metadata, or asset update |
| ![Editor reviews content quality, SEO fields, and publishing readiness](../public/assets/readme/scenarios/content-factory-review.png) | ![Approved publish-ready record with production history](../public/assets/readme/scenarios/content-factory-record.png) |
| Editor reviews content quality, SEO fields, and publishing readiness | Approved publish-ready record with production history |

### Dataset Labeling Pipeline

Use Busabase to combine agent-first labeling with human review.

Agents can pre-label examples, generate tags, write explanations, or score quality. Humans review the proposed labels before they enter the final dataset.

Examples:

- image caption review
- video scene labeling
- QA pair approval
- harmful content classification
- benchmark answer verification

Screenshots (capture with `?demo=labeling`):

| Labeling queue | Pre-label proposal |
| --- | --- |
| ![Dataset items awaiting captions, tags, scores, or benchmark answers](../public/assets/readme/scenarios/dataset-labeling-base.png) | ![Agent proposes labels, explanations, classifications, or quality scores](../public/assets/readme/scenarios/dataset-labeling-inbox.png) |
| Dataset items awaiting captions, tags, scores, or benchmark answers | Agent proposes labels, explanations, classifications, or quality scores |
| ![Human reviewer corrects or approves labels before they enter the dataset](../public/assets/readme/scenarios/dataset-labeling-review.png) | ![Approved labeled examples with review history for export](../public/assets/readme/scenarios/dataset-labeling-record.png) |
| Human reviewer corrects or approves labels before they enter the dataset | Approved labeled examples with review history for export |

### Approval-Based Project Management and ERP

Use Busabase as a lightweight approval layer for operational data.

Traditional project management and ERP systems often become the single source of truth for a team. The hard part is keeping that truth clean when humans and agents are both allowed to suggest changes.

Busabase can model operational bases such as:

| Base | Example records |
| --- | --- |
| Projects | roadmap items, milestones, owners, status |
| Tasks | assignments, due dates, priority, progress |
| Vendors | contacts, contracts, renewal dates |
| Inventory | items, quantities, locations, reorder status |
| Orders | customer requests, fulfillment status, invoices |
| Assets | documents, media, equipment, licenses |

In this model:

1. Agents can collect updates, reconcile messy data, or suggest status changes.
2. Humans review the proposed changes as Change Requests.
3. Approved Operations are merged into the source of truth.
4. Downstream tools read trusted records through the API.

This makes Busabase useful as a small, auditable data operating system: humans keep authority over trust, while AI agents help with collection, cleanup, enrichment, and routine updates.

Screenshots (capture with `?demo=operations`):

| Operations base | Status proposal |
| --- | --- |
| ![Projects, tasks, vendors, inventory, orders, or assets base as operational truth](../public/assets/readme/scenarios/operations-erp-base.png) | ![Agent proposes status changes, reconciled fields, or missing operational data](../public/assets/readme/scenarios/operations-erp-inbox.png) |
| Projects, tasks, vendors, inventory, orders, or assets base as operational truth | Agent proposes status changes, reconciled fields, or missing operational data |
| ![Manager reviews the proposed Operations before they affect the source of truth](../public/assets/readme/scenarios/operations-erp-review.png) | ![Approved operational record and downstream API-ready data](../public/assets/readme/scenarios/operations-erp-record.png) |
| Manager reviews the proposed Operations before they affect the source of truth | Approved operational record and downstream API-ready data |

### Canonical System of Record

Use Busabase as the **system of record** — the single place that holds the canonical, approved version of each record, no matter how many humans and AI agents are writing to it.

In most AI-heavy stacks, "the data" ends up scattered: a draft in a doc, a row in a spreadsheet, an agent's output in a queue, a value in a downstream app. Nobody can say which copy is authoritative. Busabase makes that explicit:

- **Canonical records** live in a Base. They are the approved truth, and the only version downstream systems should trust.
- **Proposals are not canonical.** Drafts, agent outputs, and edits arrive as Change Requests and stay separate until a reviewer merges them.
- **Every canonical record has lineage.** Each record points at the commit it was merged from, so you can always answer who proposed it, who approved it, and what it replaced.

```txt
many writers (humans + agents) -> Change Requests -> review -> canonical record -> read by everything else
```

This makes Busabase the hub other tools read from instead of writing to:

| Consumer | Reads canonical records for |
| --- | --- |
| Apps and sites | rendering approved content and data |
| Search and RAG indexes | indexing only trusted, current values |
| AI agents and tools | grounded memory they cannot silently overwrite |
| Downstream databases | a clean, audited upstream to sync from |
| Reports and dashboards | numbers everyone agrees are official |

Because writes are reviewed and reads are canonical, Busabase can sit in front of a messier database (or several) as the **approval and truth layer** — the place where a value officially becomes real.

Screenshots (capture with `?demo=canonical`):

| Canonical records | Proposal queue |
| --- | --- |
| ![Base table with approved records as the source of truth](../public/assets/readme/scenarios/canonical-base.png) | ![Change Requests from multiple writers before they become canonical](../public/assets/readme/scenarios/canonical-inbox.png) |
| Base table with approved records as the source of truth | Change Requests from multiple writers before they become canonical |
| ![Reviewer compares proposed field changes before merge](../public/assets/readme/scenarios/canonical-review.png) | ![Record lineage and audit trail after approval](../public/assets/readme/scenarios/canonical-record.png) |
| Reviewer compares proposed field changes before merge | Record lineage and audit trail after approval |

### Local Personal Knowledge Base

Run Busabase on your own machine as a private database for you and your AI tools.

- Store private notes, research, links, files, and structured records.
- Expose a local or private-network API to trusted AI agents.
- Let AI read approved knowledge without giving it uncontrolled write access.
- Audit reads, writes, reviews, merges, and deletes.
- Keep data local with PGlite persistence under `.data/busabase`.

Screenshots (capture with `?demo=knowledge`):

| Private knowledge | Local agent proposal |
| --- | --- |
| ![Local notes, research, links, and files organized in a private base](../public/assets/readme/scenarios/personal-knowledge-base.png) | ![Local agent proposes a new note or enrichment without direct write access](../public/assets/readme/scenarios/personal-knowledge-inbox.png) |
| Local notes, research, links, and files organized in a private base | Local agent proposes a new note or enrichment without direct write access |
| ![Human reviews the proposed private knowledge update on the local dashboard](../public/assets/readme/scenarios/personal-knowledge-review.png) | ![Audit trail shows approved reads, writes, reviews, and merges](../public/assets/readme/scenarios/personal-knowledge-record.png) |
| Human reviews the proposed private knowledge update on the local dashboard | Audit trail shows approved reads, writes, reviews, and merges |

### Verified Routine Work

Use Busabase for daily or weekly work that must be completed, reviewed, and recorded.

For example, a support team can run a daily customer-service quality check:

| Step | Human or agent action |
| --- | --- |
| Assign | Create today's review task for an agent or operator |
| Execute | Agent reviews conversations, classifies issues, and flags risky replies |
| Preview | Reviewer sees the agent's proposed records before they touch the source of truth |
| Approve | Human approves, rejects, or asks the agent to revise |
| Merge | Approved results become a trusted quality log |
| Trigger | Webhook notifies the team or starts the next workflow |

This is not about forcing people to do tasks. It is about routine work that needs a reliable trail:

- what work was assigned
- who or which agent performed it
- what result was proposed
- what changed during review
- who approved it
- when it became part of the trusted database

Other good fits:

- daily content publishing checks
- weekly customer research updates
- invoice reconciliation
- inventory checks
- dataset quality reviews
- support ticket classification
- compliance checklist reviews
- agent-generated market monitoring reports

Screenshots (capture with `?demo=routine`):

| Routine task log | Agent work result |
| --- | --- |
| ![Daily or weekly review task records assigned to an agent or operator](../public/assets/readme/scenarios/routine-work-base.png) | ![Agent submits completed work, classifications, or flagged issues as a proposal](../public/assets/readme/scenarios/routine-work-inbox.png) |
| Daily or weekly review task records assigned to an agent or operator | Agent submits completed work, classifications, or flagged issues as a proposal |
| ![Reviewer approves, rejects, or asks for a revised result](../public/assets/readme/scenarios/routine-work-review.png) | ![Trusted quality log with trigger or notification after merge](../public/assets/readme/scenarios/routine-work-record.png) |
| Reviewer approves, rejects, or asks for a revised result | Trusted quality log with trigger or notification after merge |

### Field Type Lab

Use Busabase to verify every supported field type and review operation in one local scenario.

The seeded `Field Type Lab` base includes text, long text, Markdown, HTML, attachment, relation, number, date, checkbox, select, multiselect, URL, email, phone, created/updated metadata fields, auto number, AI summary, and AI tags. Its review request shows a full field-level diff and view operations, so seed and demo data exercise the same surfaces that real bases use.

Screenshots (capture with `?demo=field-types`):

| Field type base | Coverage proposal |
| --- | --- |
| ![Field Type Lab base with every supported field type](../public/assets/readme/scenarios/field-types-base.png) | ![Agent proposes all-field coverage changes for review](../public/assets/readme/scenarios/field-types-inbox.png) |
| Field Type Lab base with every supported field type | Agent proposes all-field coverage changes for review |
| ![Reviewer checks attachment, relation, AI, system, and scalar field diffs](../public/assets/readme/scenarios/field-types-review.png) | ![Approved all-field record with review history](../public/assets/readme/scenarios/field-types-record.png) |
| Reviewer checks attachment, relation, AI, system, and scalar field diffs | Approved all-field record with review history |
