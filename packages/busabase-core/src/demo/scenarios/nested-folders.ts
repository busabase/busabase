import type { SeedFolderDef, SeedRichNodeDef, SeedScenario } from "../seed-types";

/**
 * A genuinely NESTED folder branch — the only one in the demo data set.
 *
 * Every other seeded folder is a single level under the workspace root, with
 * its Bases/Docs/Files sitting directly inside it. That shape never reaches
 * past the sidebar's eager prefetch (`nodes.list({ parentId: null, depth: 2 })`
 * = root + 2 levels), so a fresh workspace never exercised — and could never
 * demo — expanding a folder that has to fetch its children lazily. This branch
 * is 4 folder levels deep on purpose:
 *
 *   Product Ops                  (level 1 — prefetched)
 *   └── 2026 Launch              (level 2 — prefetched, children are NOT: the
 *       │                                    first lazy `onExpand` fetch)
 *       ├── Launch Assets        (level 3 — arrives with that fetch)
 *       │   ├── Brand Kit        (level 4 — arrives with that fetch; its own
 *       │   │   └── One-Pager …             children need a SECOND lazy fetch)
 *       │   └── Press Page
 *       └── Launch Checklist
 *   └── Archive                  (level 2)
 *       └── 2025 Retro           (level 3)
 *           └── Retro Summary
 *
 * so `pnpm db:seed:all && pnpm dev` is enough to click through the whole
 * lazy-expand path by hand, and any regression in it is visible in the demo
 * workspace instead of only in a customer's own tree.
 *
 * Leaf content is deliberately plain `html` nodes: they need no Base/fields/
 * records/views, so the branch stays about the folder nesting.
 */

export const NESTED_PRODUCT_OPS_FOLDER_NODE_ID = "nod_nested_product_ops";
export const NESTED_LAUNCH_FOLDER_NODE_ID = "nod_nested_launch_2026";
export const NESTED_LAUNCH_ASSETS_FOLDER_NODE_ID = "nod_nested_launch_assets";
export const NESTED_BRAND_KIT_FOLDER_NODE_ID = "nod_nested_brand_kit";
export const NESTED_ARCHIVE_FOLDER_NODE_ID = "nod_nested_archive";
export const NESTED_RETRO_FOLDER_NODE_ID = "nod_nested_retro_2025";

/** Shared by the English and zh-CN twins — only the labels differ. */
export const nestedFolderShape = {
  productOps: { nodeId: NESTED_PRODUCT_OPS_FOLDER_NODE_ID, slug: "product-ops", position: 12 },
  launch: {
    nodeId: NESTED_LAUNCH_FOLDER_NODE_ID,
    parentNodeId: NESTED_PRODUCT_OPS_FOLDER_NODE_ID,
    slug: "launch-2026",
    position: 0,
  },
  launchAssets: {
    nodeId: NESTED_LAUNCH_ASSETS_FOLDER_NODE_ID,
    parentNodeId: NESTED_LAUNCH_FOLDER_NODE_ID,
    slug: "launch-assets",
    position: 0,
  },
  brandKit: {
    nodeId: NESTED_BRAND_KIT_FOLDER_NODE_ID,
    parentNodeId: NESTED_LAUNCH_ASSETS_FOLDER_NODE_ID,
    slug: "brand-kit",
    position: 0,
  },
  archive: {
    nodeId: NESTED_ARCHIVE_FOLDER_NODE_ID,
    parentNodeId: NESTED_PRODUCT_OPS_FOLDER_NODE_ID,
    slug: "product-ops-archive",
    position: 1,
  },
  retro: {
    nodeId: NESTED_RETRO_FOLDER_NODE_ID,
    parentNodeId: NESTED_ARCHIVE_FOLDER_NODE_ID,
    slug: "retro-2025",
    position: 0,
  },
} as const;

/** A tiny, readable HTML page — the leaf content at each nesting level. */
export const nestedHtmlPage = (title: string, lede: string, bullets: string[]): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${title}</title>`,
    "  <style>",
    "    body { margin: 0; padding: 40px 32px; font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; color: #0f172a; background: #f8fafc; }",
    "    main { max-width: 640px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; }",
    "    h1 { margin: 0 0 8px; font-size: 24px; }",
    "    p { margin: 0 0 20px; color: #475569; }",
    "    li { margin-bottom: 8px; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    `    <h1>${title}</h1>`,
    `    <p>${lede}</p>`,
    "    <ul>",
    ...bullets.map((bullet) => `      <li>${bullet}</li>`),
    "    </ul>",
    "  </main>",
    "</body>",
    "</html>",
  ].join("\n");

const folders: SeedFolderDef[] = [
  {
    ...nestedFolderShape.productOps,
    name: "Product Ops",
    description: "How a release is run — nested by campaign, then by workstream.",
  },
  {
    ...nestedFolderShape.launch,
    name: "2026 Launch",
    description: "Everything for the 2026 launch, one subfolder per workstream.",
  },
  {
    ...nestedFolderShape.launchAssets,
    name: "Launch Assets",
    description: "Pages and visuals shipped with the launch.",
  },
  {
    ...nestedFolderShape.brandKit,
    name: "Brand Kit",
    description: "Logo, colours, and the one-pager partners get.",
  },
  {
    ...nestedFolderShape.archive,
    name: "Archive",
    description: "Closed campaigns, kept for reference.",
  },
  {
    ...nestedFolderShape.retro,
    name: "2025 Retro",
    description: "What the previous launch taught us.",
  },
];

const richNodes: SeedRichNodeDef[] = [
  {
    nodeType: "html",
    nodeId: "nod_nested_html_launch_checklist",
    folderNodeId: NESTED_LAUNCH_FOLDER_NODE_ID,
    slug: "launch-checklist",
    name: "Launch Checklist",
    description: "The go/no-go list for launch day.",
    position: 1,
    metadata: {
      htmlDocument: {
        version: 1,
        source: nestedHtmlPage(
          "2026 Launch checklist",
          "Everything that has to be approved before launch day.",
          [
            "Pricing page reviewed and merged",
            "Docs updated for the new onboarding flow",
            "Support macros written and approved",
            "Status page and rollback plan confirmed",
          ],
        ),
      },
    },
  },
  {
    nodeType: "html",
    nodeId: "nod_nested_html_press_page",
    folderNodeId: NESTED_LAUNCH_ASSETS_FOLDER_NODE_ID,
    slug: "launch-press-page",
    name: "Press Page",
    description: "The public press page draft for launch week.",
    position: 1,
    metadata: {
      htmlDocument: {
        version: 1,
        source: nestedHtmlPage("Press page draft", "What the press sees on launch day.", [
          "Headline and one-line positioning",
          "Three product screenshots with captions",
          "Founder quote, approved by comms",
          "Contact address for interview requests",
        ]),
      },
    },
  },
  {
    nodeType: "html",
    nodeId: "nod_nested_html_one_pager",
    folderNodeId: NESTED_BRAND_KIT_FOLDER_NODE_ID,
    slug: "launch-one-pager",
    name: "Partner One-Pager",
    description: "The single page partners get when they ask what shipped.",
    position: 0,
    metadata: {
      htmlDocument: {
        version: 1,
        source: nestedHtmlPage(
          "Partner one-pager",
          "One page a partner can forward internally without any context from us.",
          [
            "What changed, in one sentence",
            "Who it is for, and who it is not for",
            "Logo and colour usage rules",
            "Where to send questions",
          ],
        ),
      },
    },
  },
  {
    nodeType: "html",
    nodeId: "nod_nested_html_retro_summary",
    folderNodeId: NESTED_RETRO_FOLDER_NODE_ID,
    slug: "retro-2025-summary",
    name: "Retro Summary",
    description: "What the 2025 launch taught us, in one page.",
    position: 0,
    metadata: {
      htmlDocument: {
        version: 1,
        source: nestedHtmlPage("2025 launch retro", "Kept short on purpose — four takeaways.", [
          "The checklist was written too late to be useful",
          "Docs and pricing shipped out of sync",
          "Support had no macros on day one",
          "The rollback plan was never rehearsed",
        ]),
      },
    },
  },
];

export const nestedFoldersScenario: SeedScenario = { folders, richNodes };
