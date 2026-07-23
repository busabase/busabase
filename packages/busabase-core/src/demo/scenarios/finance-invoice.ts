import type {
  SeedBaseDef,
  SeedChangeRequestDef,
  SeedFolderDef,
  SeedRecordDef,
  SeedViewDef,
} from "../seed-types";

export const DEMO_FINANCE_FOLDER_NODE_ID = "nod_finance";
export const DEMO_PURCHASE_ORDERS_BASE_ID = "bse_local_purchase_orders";
export const DEMO_PURCHASE_ORDERS_BASE_NODE_ID = "nod_base_purchase_orders";
export const DEMO_INVOICES_BASE_ID = "bse_local_invoices";
export const DEMO_INVOICES_BASE_NODE_ID = "nod_base_invoices";

export const FINANCE_PO_PLATFORM_ID = "rec_seed_po_platform";
const FINANCE_PO_PLATFORM_COMMIT_ID = "cmt_seed_po_platform";
export const FINANCE_PO_DESIGN_ID = "rec_seed_po_design";
const FINANCE_PO_DESIGN_COMMIT_ID = "cmt_seed_po_design";
export const FINANCE_PO_MARKETING_ID = "rec_seed_po_marketing";
const FINANCE_PO_MARKETING_COMMIT_ID = "cmt_seed_po_marketing";
export const FINANCE_PO_SUPPORT_ID = "rec_seed_po_support";
const FINANCE_PO_SUPPORT_COMMIT_ID = "cmt_seed_po_support";
export const FINANCE_INVOICE_GLOBEX_ID = "rec_seed_invoice_globex_cloud";
const FINANCE_INVOICE_GLOBEX_COMMIT_ID = "cmt_seed_invoice_globex_cloud";
export const FINANCE_INVOICE_FIGMA_ID = "rec_seed_invoice_figma_seats";
const FINANCE_INVOICE_FIGMA_COMMIT_ID = "cmt_seed_invoice_figma_seats";
export const FINANCE_INVOICE_MARKETING_ID = "rec_seed_invoice_marketing_suite";
const FINANCE_INVOICE_MARKETING_COMMIT_ID = "cmt_seed_invoice_marketing_suite";
export const FINANCE_INVOICE_SUPPORT_ID = "rec_seed_invoice_support_platform";
const FINANCE_INVOICE_SUPPORT_COMMIT_ID = "cmt_seed_invoice_support_platform";
export const FINANCE_INVOICE_REVIEW_ID = "crq_seed_invoice_three_way_match";

export const FINANCE_FOLDERS: SeedFolderDef[] = [
  {
    nodeId: DEMO_FINANCE_FOLDER_NODE_ID,
    slug: "finance",
    name: "Finance",
    description: "Invoices, purchase orders, receipts, and payment approvals.",
    position: 2,
  },
];

const purchaseOrderFields = [
  {
    id: "bsf_po_number",
    slug: "po_number",
    name: "PO Number",
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_po_vendor",
    slug: "vendor",
    name: "Vendor",
    type: "text",
    required: true,
    options: {},
  },
  { id: "bsf_po_owner", slug: "owner", name: "Owner", type: "email", required: false, options: {} },
  {
    id: "bsf_po_budget",
    slug: "budget",
    name: "Budget",
    type: "number",
    required: false,
    options: {},
  },
  {
    id: "bsf_po_currency",
    slug: "currency",
    name: "Currency",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_po_approved_at",
    slug: "approved_at",
    name: "Approved At",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_po_status",
    slug: "status",
    name: "Status",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "open", name: "Open", color: "amber" },
        { id: "matched", name: "Matched", color: "emerald" },
        { id: "closed", name: "Closed", color: "slate" },
      ],
    },
  },
] satisfies SeedBaseDef["fields"];

const invoiceFields = [
  {
    id: "bsf_invoice_number",
    slug: "invoice_number",
    name: "Invoice Number",
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_invoice_vendor",
    slug: "vendor",
    name: "Vendor",
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_invoice_po",
    slug: "purchase-order",
    name: "Purchase Order",
    type: "relation",
    required: false,
    options: { multiple: false, targetBaseId: DEMO_PURCHASE_ORDERS_BASE_ID },
  },
  {
    id: "bsf_invoice_amount",
    slug: "amount",
    name: "Amount",
    type: "number",
    required: false,
    options: {},
  },
  { id: "bsf_invoice_tax", slug: "tax", name: "Tax", type: "number", required: false, options: {} },
  {
    id: "bsf_invoice_total",
    slug: "total",
    name: "Total",
    type: "number",
    required: false,
    options: {},
  },
  {
    id: "bsf_invoice_due_date",
    slug: "due_date",
    name: "Due Date",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_invoice_attachment",
    slug: "invoice_file",
    name: "Invoice File",
    type: "attachment",
    required: false,
    options: {
      attachment: {
        allowedMimeTypes: ["application/pdf", "image/png"],
        maxFileSize: 15 * 1024 * 1024,
        maxFiles: 3,
      },
    },
  },
  {
    id: "bsf_invoice_status",
    slug: "status",
    name: "Status",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "needs-review", name: "Needs review", color: "amber" },
        { id: "matched", name: "Matched", color: "emerald" },
        { id: "exception", name: "Exception", color: "rose" },
        { id: "paid", name: "Paid", color: "slate" },
      ],
    },
  },
  {
    id: "bsf_invoice_flags",
    slug: "flags",
    name: "Flags",
    type: "multiselect",
    required: false,
    options: {
      choices: [
        { id: "amount-mismatch", name: "Amount mismatch", color: "rose" },
        { id: "tax-check", name: "Tax check", color: "amber" },
        { id: "po-match", name: "PO match", color: "emerald" },
      ],
    },
  },
  {
    id: "bsf_invoice_paid",
    slug: "ready_to_pay",
    name: "Ready To Pay",
    type: "checkbox",
    required: false,
    options: {},
  },
  {
    id: "bsf_invoice_notes",
    slug: "review_notes",
    name: "Review Notes",
    type: "longtext",
    required: false,
    options: {},
  },
  {
    id: "bsf_invoice_ai_summary",
    slug: "ai_summary",
    name: "AI Summary",
    type: "ai_summary",
    required: false,
    options: {
      ai: { model: "gpt-5-mini", reviewRequired: true, sourceFieldIds: ["bsf_invoice_notes"] },
    },
  },
] satisfies SeedBaseDef["fields"];

export const FINANCE_BASES: SeedBaseDef[] = [
  {
    id: DEMO_PURCHASE_ORDERS_BASE_ID,
    nodeId: DEMO_PURCHASE_ORDERS_BASE_NODE_ID,
    slug: "purchase-orders",
    name: "Purchase Orders",
    description: "Approved spend envelopes used for invoice matching.",
    folderNodeId: DEMO_FINANCE_FOLDER_NODE_ID,
    useCases: ["finance"],
    fields: purchaseOrderFields,
  },
  {
    id: DEMO_INVOICES_BASE_ID,
    nodeId: DEMO_INVOICES_BASE_NODE_ID,
    slug: "invoices",
    name: "Invoices",
    description: "Invoices waiting for AP review, PO matching, and payment approval.",
    folderNodeId: DEMO_FINANCE_FOLDER_NODE_ID,
    useCases: ["finance"],
    fields: invoiceFields,
  },
];

export const FINANCE_RECORDS: SeedRecordDef[] = [
  {
    id: FINANCE_PO_PLATFORM_ID,
    baseId: DEMO_PURCHASE_ORDERS_BASE_ID,
    commitId: FINANCE_PO_PLATFORM_COMMIT_ID,
    fields: {
      approved_at: "2026-05-20",
      budget: 125000,
      currency: "USD",
      owner: "finance.ops@busabase.local",
      po_number: "PO-2026-0418",
      status: "open",
      vendor: "Globex Cloud Services",
    },
    message: "Seed approved cloud platform purchase order",
    author: "seed-finance",
    minutesAgo: 170,
    useCases: ["finance"],
  },
  {
    id: FINANCE_PO_DESIGN_ID,
    baseId: DEMO_PURCHASE_ORDERS_BASE_ID,
    commitId: FINANCE_PO_DESIGN_COMMIT_ID,
    fields: {
      approved_at: "2026-05-28",
      budget: 18000,
      currency: "USD",
      owner: "design.ops@busabase.local",
      po_number: "PO-2026-0472",
      status: "matched",
      vendor: "Figma Seats",
    },
    message: "Seed design software purchase order",
    author: "seed-finance",
    minutesAgo: 168,
    useCases: ["finance"],
  },
  {
    id: FINANCE_PO_MARKETING_ID,
    baseId: DEMO_PURCHASE_ORDERS_BASE_ID,
    commitId: FINANCE_PO_MARKETING_COMMIT_ID,
    fields: {
      approved_at: "2026-06-02",
      budget: 42000,
      currency: "USD",
      owner: "marketing.ops@busabase.local",
      po_number: "PO-2026-0503",
      status: "closed",
      vendor: "Marketing Analytics Suite",
    },
    message: "Seed marketing analytics purchase order",
    author: "seed-finance",
    minutesAgo: 150,
    useCases: ["finance"],
  },
  {
    id: FINANCE_PO_SUPPORT_ID,
    baseId: DEMO_PURCHASE_ORDERS_BASE_ID,
    commitId: FINANCE_PO_SUPPORT_COMMIT_ID,
    fields: {
      approved_at: "2026-06-10",
      budget: 9600,
      currency: "USD",
      owner: "support.ops@busabase.local",
      po_number: "PO-2026-0519",
      status: "open",
      vendor: "Support Ticketing Platform",
    },
    message: "Seed support ticketing purchase order",
    author: "seed-finance",
    minutesAgo: 140,
    useCases: ["finance"],
  },
  {
    id: FINANCE_INVOICE_GLOBEX_ID,
    baseId: DEMO_INVOICES_BASE_ID,
    commitId: FINANCE_INVOICE_GLOBEX_COMMIT_ID,
    fields: {
      ai_summary:
        "Cloud invoice is within the approved PO but needs AP review for tax and service-period notes.",
      amount: 118400,
      due_date: "2026-07-05",
      flags: ["po-match", "tax-check"],
      invoice_file: [
        {
          id: "att_seed_invoice_globex_pdf",
          attachmentId: "att_seed_invoice_globex_pdf",
          fileName: "globex-cloud-invoice-2026-06.pdf",
          mimeType: "application/pdf",
          size: 624_128,
          url: "/assets/readme/scenarios/finance-review-base.png",
        },
      ],
      invoice_number: "INV-GCX-2026-0618",
      "purchase-order": [FINANCE_PO_PLATFORM_ID],
      ready_to_pay: false,
      review_notes:
        "OCR matched vendor, PO number, billing period, and subtotal. Tax line needs finance approval.",
      status: "needs-review",
      tax: 9472,
      total: 127872,
      vendor: "Globex Cloud Services",
    },
    message: "Seed invoice awaiting AP match review",
    author: "seed-finance",
    minutesAgo: 120,
    useCases: ["finance"],
  },
  {
    id: FINANCE_INVOICE_FIGMA_ID,
    baseId: DEMO_INVOICES_BASE_ID,
    commitId: FINANCE_INVOICE_FIGMA_COMMIT_ID,
    fields: {
      ai_summary: "Design software invoice matches PO and is ready for payment.",
      amount: 17280,
      due_date: "2026-07-10",
      flags: ["po-match"],
      invoice_file: [
        {
          id: "att_seed_invoice_figma_png",
          attachmentId: "att_seed_invoice_figma_png",
          fileName: "figma-seats-invoice.png",
          mimeType: "image/png",
          size: 218_944,
          url: "/assets/readme/scenarios/finance-review-record.png",
        },
      ],
      invoice_number: "INV-FIG-2026-0441",
      "purchase-order": [FINANCE_PO_DESIGN_ID],
      ready_to_pay: true,
      review_notes: "Seat count, vendor name, and annual contract dates match the approved PO.",
      status: "matched",
      tax: 0,
      total: 17280,
      vendor: "Figma Seats",
    },
    message: "Seed matched design software invoice",
    author: "seed-finance",
    minutesAgo: 118,
    useCases: ["finance"],
  },
  {
    id: FINANCE_INVOICE_MARKETING_ID,
    baseId: DEMO_INVOICES_BASE_ID,
    commitId: FINANCE_INVOICE_MARKETING_COMMIT_ID,
    fields: {
      ai_summary: "Marketing analytics invoice matches PO and has been paid.",
      amount: 42000,
      due_date: "2026-06-25",
      flags: ["po-match"],
      invoice_file: [
        {
          id: "att_seed_invoice_marketing_pdf",
          attachmentId: "att_seed_invoice_marketing_pdf",
          fileName: "marketing-analytics-invoice.pdf",
          mimeType: "application/pdf",
          size: 301_056,
          url: "/assets/readme/scenarios/finance-review-base.png",
        },
      ],
      invoice_number: "INV-MKT-2026-0512",
      "purchase-order": [FINANCE_PO_MARKETING_ID],
      ready_to_pay: true,
      review_notes: "Annual contract renewal, amount matches PO exactly. Paid on schedule.",
      status: "paid",
      tax: 0,
      total: 42000,
      vendor: "Marketing Analytics Suite",
    },
    message: "Seed paid marketing analytics invoice",
    author: "seed-finance",
    minutesAgo: 100,
    useCases: ["finance"],
  },
  {
    id: FINANCE_INVOICE_SUPPORT_ID,
    baseId: DEMO_INVOICES_BASE_ID,
    commitId: FINANCE_INVOICE_SUPPORT_COMMIT_ID,
    fields: {
      ai_summary:
        "Support platform invoice is $1,200 over the approved PO amount — flagged for AP review before payment.",
      amount: 10800,
      due_date: "2026-07-15",
      flags: ["amount-mismatch"],
      invoice_file: [
        {
          id: "att_seed_invoice_support_pdf",
          attachmentId: "att_seed_invoice_support_pdf",
          fileName: "support-platform-invoice.pdf",
          mimeType: "application/pdf",
          size: 187_392,
          url: "/assets/readme/scenarios/finance-review-record.png",
        },
      ],
      invoice_number: "INV-SUP-2026-0533",
      "purchase-order": [FINANCE_PO_SUPPORT_ID],
      ready_to_pay: false,
      review_notes:
        "Vendor billed for an add-on seat tier not on the approved PO. Waiting on a decision to approve the overage or push back.",
      status: "exception",
      tax: 800,
      total: 11600,
      vendor: "Support Ticketing Platform",
    },
    message: "Seed support platform invoice with a PO amount mismatch",
    author: "seed-finance",
    minutesAgo: 75,
    useCases: ["finance"],
  },
];

export const FINANCE_VIEWS: SeedViewDef[] = [
  {
    id: "viw_seed_invoice_review",
    baseId: DEMO_INVOICES_BASE_ID,
    slug: "needs-ap-review",
    name: "Needs AP review",
    description: "Invoices with exceptions, tax checks, or missing payment approval.",
    config: {
      filters: [{ fieldSlug: "status", operator: "equals", value: "needs-review" }],
      sorts: [{ direction: "asc", fieldSlug: "due_date" }],
      visibleFieldSlugs: [
        "invoice_number",
        "vendor",
        "purchase-order",
        "total",
        "due_date",
        "flags",
        "ready_to_pay",
      ],
    },
    minutesAgo: 110,
    useCases: ["finance"],
  },
  {
    id: "viw_seed_invoice_board",
    baseId: DEMO_INVOICES_BASE_ID,
    slug: "board",
    name: "AP board",
    description: "Every invoice stacked by status — drag a card as it moves through AP.",
    type: "kanban",
    config: { filters: [], sorts: [], stackByFieldSlug: "status" },
    minutesAgo: 109,
    useCases: ["finance"],
  },
  {
    id: "viw_seed_invoice_calendar",
    baseId: DEMO_INVOICES_BASE_ID,
    slug: "due-calendar",
    name: "Due date calendar",
    description: "Invoices placed on the month they're due for payment.",
    type: "calendar",
    config: { filters: [], sorts: [], dateFieldSlug: "due_date" },
    minutesAgo: 108,
    useCases: ["finance"],
  },
  {
    id: "viw_seed_po_board",
    baseId: DEMO_PURCHASE_ORDERS_BASE_ID,
    slug: "board",
    name: "PO board",
    description: "Purchase orders stacked by status.",
    type: "kanban",
    config: { filters: [], sorts: [], stackByFieldSlug: "status" },
    minutesAgo: 107,
    useCases: ["finance"],
  },
];

export const FINANCE_CHANGE_REQUESTS: SeedChangeRequestDef[] = [
  {
    id: FINANCE_INVOICE_REVIEW_ID,
    baseId: DEMO_INVOICES_BASE_ID,
    status: "in_review",
    submittedBy: "ap-reconcile-agent",
    sourceMeta: { seed: true, scenario: "invoice-three-way-match", workflow: "ap-review" },
    minutesAgo: 6,
    useCases: ["finance"],
    operations: [
      {
        id: "opr_seed_invoice_three_way_match",
        commitId: "cmt_seed_invoice_three_way_match",
        operation: "record_update",
        targetRecordId: FINANCE_INVOICE_GLOBEX_ID,
        baseCommitId: FINANCE_INVOICE_GLOBEX_COMMIT_ID,
        baseFields: {
          ai_summary:
            "Cloud invoice is within the approved PO but needs AP review for tax and service-period notes.",
          amount: 118400,
          due_date: "2026-07-05",
          flags: ["po-match", "tax-check"],
          invoice_file: [
            {
              id: "att_seed_invoice_globex_pdf",
              attachmentId: "att_seed_invoice_globex_pdf",
              fileName: "globex-cloud-invoice-2026-06.pdf",
              mimeType: "application/pdf",
              size: 624_128,
              url: "/assets/readme/scenarios/finance-review-base.png",
            },
          ],
          invoice_number: "INV-GCX-2026-0618",
          "purchase-order": [FINANCE_PO_PLATFORM_ID],
          ready_to_pay: false,
          review_notes:
            "OCR matched vendor, PO number, billing period, and subtotal. Tax line needs finance approval.",
          status: "needs-review",
          tax: 9472,
          total: 127872,
          vendor: "Globex Cloud Services",
        },
        fields: {
          ai_summary:
            "Three-way match passed: vendor, PO, subtotal, tax, and service period are ready for payment approval.",
          amount: 118400,
          due_date: "2026-07-05",
          flags: ["po-match"],
          invoice_file: [
            {
              id: "att_seed_invoice_globex_pdf",
              attachmentId: "att_seed_invoice_globex_pdf",
              fileName: "globex-cloud-invoice-2026-06.pdf",
              mimeType: "application/pdf",
              size: 624_128,
              url: "/assets/readme/scenarios/finance-review-base.png",
            },
          ],
          invoice_number: "INV-GCX-2026-0618",
          "purchase-order": [FINANCE_PO_PLATFORM_ID],
          ready_to_pay: true,
          review_notes:
            "Matched against PO-2026-0418. Tax line agrees with contract terms; approve for July payment run.",
          status: "matched",
          tax: 9472,
          total: 127872,
          vendor: "Globex Cloud Services",
        },
        message: "Approve matched invoice for July payment run",
        author: "ap-reconcile-agent",
      },
    ],
  },
];
