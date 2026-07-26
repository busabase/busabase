// Demo scenario: a global stock-picking watchlist. Exercises busabase's
// `formula` field type (packages/busabase-core/src/domains/base/formula/)
// end to end — three currency-formatted `number` columns (USD/HKD/JPY, each
// with its own Intl.NumberFormat display via options.number) feed three
// `formula` columns that cross-reference them: a USD-normalized combined
// price, an upside %, and a Buy/Hold/Sell signal. See that module's header
// comment for the engine design (ported from bika/vikadata's formula_parser).
import { evaluateFormula, type FormulaValue } from "../../domains/base/formula";
import type { SeedBaseDef, SeedFolderDef, SeedRecordDef, SeedViewDef } from "../seed-types";

// A rough illustrative FX cross-rate normalization, not a live quote: sum the
// three listings' USD-equivalent value (HKD ÷ ~7.8, JPY ÷ ~150).
const PRICE_COMBINED_USD_EXPRESSION =
  "ROUND({price_usd} + {price_hkd} / 7.8 + {price_jpy} / 150, 2)";
const UPSIDE_PCT_EXPRESSION = "ROUND(({target_price_usd} - {price_usd}) / {price_usd} * 100, 1)";
const SIGNAL_EXPRESSION =
  'IF({target_price_usd} > {price_usd} * 1.15, "Buy", IF({target_price_usd} > {price_usd}, "Hold", "Sell"))';

// The real (`nodes/change-requests` merge) write path computes `formula`
// fields live via field-types.ts's `compute` registry — but the seed path
// (`logic/seed.ts`) writes commit fields directly and never runs that
// registry (the same reason `auto_number`/`created_time` values are baked
// into seed data elsewhere in this file's siblings, e.g. dataset.ts's
// `auto_number: 1001`). Evaluate with the SAME engine + the SAME expression
// strings as the field definitions below, so the seeded values can never
// drift from what a real write would compute.
const withComputedFormulas = (
  fields: Record<string, FormulaValue>,
): Record<string, FormulaValue> => {
  const resolveField = (slug: string): FormulaValue => fields[slug] ?? null;
  return {
    ...fields,
    price_combined_usd: evaluateFormula(PRICE_COMBINED_USD_EXPRESSION, resolveField),
    upside_pct: evaluateFormula(UPSIDE_PCT_EXPRESSION, resolveField),
    signal: evaluateFormula(SIGNAL_EXPRESSION, resolveField),
  };
};

export const DEMO_STOCK_PICKING_FOLDER_NODE_ID = "nod_stock_picking";
export const DEMO_STOCK_WATCHLIST_BASE_ID = "bse_local_stock_watchlist";
export const DEMO_STOCK_WATCHLIST_BASE_NODE_ID = "nod_base_stock_watchlist";

const STOCK_AAPL_ID = "rec_seed_stock_aapl";
const STOCK_AAPL_COMMIT_ID = "cmt_seed_stock_aapl";
const STOCK_TENCENT_ID = "rec_seed_stock_tencent";
const STOCK_TENCENT_COMMIT_ID = "cmt_seed_stock_tencent";
const STOCK_TOYOTA_ID = "rec_seed_stock_toyota";
const STOCK_TOYOTA_COMMIT_ID = "cmt_seed_stock_toyota";
const STOCK_ALIBABA_ID = "rec_seed_stock_alibaba";
const STOCK_ALIBABA_COMMIT_ID = "cmt_seed_stock_alibaba";
const STOCK_SONY_ID = "rec_seed_stock_sony";
const STOCK_SONY_COMMIT_ID = "cmt_seed_stock_sony";
const STOCK_HSBC_ID = "rec_seed_stock_hsbc";
const STOCK_HSBC_COMMIT_ID = "cmt_seed_stock_hsbc";

export const STOCK_PICKING_FOLDERS: SeedFolderDef[] = [
  {
    nodeId: DEMO_STOCK_PICKING_FOLDER_NODE_ID,
    slug: "stock-picking",
    name: "Stock Picking",
    description: "A cross-market watchlist with formula-driven buy/sell signals.",
    position: 5,
  },
];

const stockWatchlistFields = [
  {
    id: "bsf_stock_ticker",
    slug: "ticker",
    name: "Ticker",
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_stock_company",
    slug: "company",
    name: "Company",
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_stock_sector",
    slug: "sector",
    name: "Sector",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "technology", name: "Technology", color: "violet" },
        { id: "consumer", name: "Consumer", color: "amber" },
        { id: "finance", name: "Finance", color: "sky" },
      ],
    },
  },
  // Three currency-formatted number columns — the same listing quoted across
  // three markets, each rendered with its own Intl.NumberFormat currency
  // style (see helpers/format.ts's formatNumberField).
  {
    id: "bsf_stock_price_usd",
    slug: "price_usd",
    name: "Price (USD)",
    type: "number",
    required: false,
    options: { number: { format: "currency", currency: "USD", locale: "en-US" } },
  },
  {
    id: "bsf_stock_price_hkd",
    slug: "price_hkd",
    name: "Price (HKD)",
    type: "number",
    required: false,
    options: { number: { format: "currency", currency: "HKD", locale: "zh-HK" } },
  },
  {
    id: "bsf_stock_price_jpy",
    slug: "price_jpy",
    name: "Price (JPY)",
    type: "number",
    required: false,
    options: { number: { format: "currency", currency: "JPY", locale: "ja-JP" } },
  },
  {
    id: "bsf_stock_target_price_usd",
    slug: "target_price_usd",
    name: "Target Price (USD)",
    type: "number",
    required: false,
    options: { number: { format: "currency", currency: "USD", locale: "en-US" } },
  },
  // Formula columns — each references the raw currency/number fields above
  // directly (never another formula field; see the module header + ../base/formula's
  // "no dependency graph yet" note for why chained formulas aren't supported).
  {
    id: "bsf_stock_price_combined_usd",
    slug: "price_combined_usd",
    name: "Combined Price (USD equiv.)",
    type: "formula",
    required: false,
    options: {
      formula: { expression: PRICE_COMBINED_USD_EXPRESSION },
    },
  },
  {
    id: "bsf_stock_upside_pct",
    slug: "upside_pct",
    name: "Upside %",
    type: "formula",
    required: false,
    options: {
      formula: { expression: UPSIDE_PCT_EXPRESSION },
    },
  },
  {
    id: "bsf_stock_signal",
    slug: "signal",
    name: "Signal",
    type: "formula",
    required: false,
    options: {
      formula: { expression: SIGNAL_EXPRESSION },
    },
  },
  {
    id: "bsf_stock_thesis",
    slug: "thesis",
    name: "Thesis",
    type: "longtext",
    required: false,
    options: {},
  },
  {
    id: "bsf_stock_watching",
    slug: "watching",
    name: "Watching",
    type: "checkbox",
    required: false,
    options: {},
  },
] satisfies SeedBaseDef["fields"];

export const STOCK_PICKING_BASES: SeedBaseDef[] = [
  {
    id: DEMO_STOCK_WATCHLIST_BASE_ID,
    nodeId: DEMO_STOCK_WATCHLIST_BASE_NODE_ID,
    slug: "stock-watchlist",
    name: "Stock Watchlist",
    description:
      "Global stocks quoted across three markets, with formula columns for a USD-normalized price, upside %, and buy/sell signal.",
    folderNodeId: DEMO_STOCK_PICKING_FOLDER_NODE_ID,
    useCases: ["stock-picking"],
    fields: stockWatchlistFields,
  },
];

export const STOCK_PICKING_RECORDS: SeedRecordDef[] = [
  {
    id: STOCK_AAPL_ID,
    baseId: DEMO_STOCK_WATCHLIST_BASE_ID,
    commitId: STOCK_AAPL_COMMIT_ID,
    fields: withComputedFormulas({
      ticker: "AAPL",
      company: "Apple Inc.",
      sector: "technology",
      price_usd: 195.5,
      price_hkd: 1525.0,
      price_jpy: 29200,
      target_price_usd: 230,
      thesis: "Services growth and on-device AI features widen the moat around the installed base.",
      watching: true,
    }),
    message: "Seed AAPL watchlist entry",
    author: "seed-stock-picking",
    minutesAgo: 90,
    useCases: ["stock-picking"],
  },
  {
    id: STOCK_TENCENT_ID,
    baseId: DEMO_STOCK_WATCHLIST_BASE_ID,
    commitId: STOCK_TENCENT_COMMIT_ID,
    fields: withComputedFormulas({
      ticker: "0700.HK",
      company: "Tencent Holdings",
      sector: "technology",
      price_usd: 46.2,
      price_hkd: 360.0,
      price_jpy: 6900,
      target_price_usd: 55,
      thesis: "Gaming reacceleration plus ad-load recovery in Weixin Channels.",
      watching: true,
    }),
    message: "Seed Tencent watchlist entry",
    author: "seed-stock-picking",
    minutesAgo: 88,
    useCases: ["stock-picking"],
  },
  {
    id: STOCK_TOYOTA_ID,
    baseId: DEMO_STOCK_WATCHLIST_BASE_ID,
    commitId: STOCK_TOYOTA_COMMIT_ID,
    fields: withComputedFormulas({
      ticker: "7203.T",
      company: "Toyota Motor Corp.",
      sector: "consumer",
      price_usd: 18.8,
      price_hkd: 146.5,
      price_jpy: 2810,
      target_price_usd: 20,
      thesis: "Hybrid mix cushions margin while the EV lineup ramps; limited near-term upside.",
      watching: false,
    }),
    message: "Seed Toyota watchlist entry",
    author: "seed-stock-picking",
    minutesAgo: 86,
    useCases: ["stock-picking"],
  },
  {
    id: STOCK_ALIBABA_ID,
    baseId: DEMO_STOCK_WATCHLIST_BASE_ID,
    commitId: STOCK_ALIBABA_COMMIT_ID,
    fields: withComputedFormulas({
      ticker: "BABA",
      company: "Alibaba Group",
      sector: "technology",
      price_usd: 82.3,
      price_hkd: 641.0,
      price_jpy: 12300,
      target_price_usd: 110,
      thesis: "Cloud unit re-accelerating; buyback pace supports valuation floor.",
      watching: true,
    }),
    message: "Seed Alibaba watchlist entry",
    author: "seed-stock-picking",
    minutesAgo: 84,
    useCases: ["stock-picking"],
  },
  {
    id: STOCK_SONY_ID,
    baseId: DEMO_STOCK_WATCHLIST_BASE_ID,
    commitId: STOCK_SONY_COMMIT_ID,
    fields: withComputedFormulas({
      ticker: "6758.T",
      company: "Sony Group Corp.",
      sector: "technology",
      price_usd: 24.6,
      price_hkd: 191.5,
      price_jpy: 3670,
      target_price_usd: 26,
      thesis: "Games + music annuity-like cash flow; image-sensor cycle is the swing factor.",
      watching: false,
    }),
    message: "Seed Sony watchlist entry",
    author: "seed-stock-picking",
    minutesAgo: 82,
    useCases: ["stock-picking"],
  },
  {
    id: STOCK_HSBC_ID,
    baseId: DEMO_STOCK_WATCHLIST_BASE_ID,
    commitId: STOCK_HSBC_COMMIT_ID,
    fields: withComputedFormulas({
      ticker: "HSBA",
      company: "HSBC Holdings",
      sector: "finance",
      price_usd: 44.1,
      price_hkd: 344.0,
      price_jpy: 6580,
      target_price_usd: 48,
      thesis: "Rate-cut cycle compresses NIM; Asia wealth build-out is the offsetting driver.",
      watching: false,
    }),
    message: "Seed HSBC watchlist entry",
    author: "seed-stock-picking",
    minutesAgo: 80,
    useCases: ["stock-picking"],
  },
];

export const STOCK_PICKING_VIEWS: SeedViewDef[] = [
  {
    id: "viw_seed_stock_watchlist_all",
    baseId: DEMO_STOCK_WATCHLIST_BASE_ID,
    slug: "all",
    name: "All",
    description: "Every tracked stock with its cross-market prices and computed signal.",
    config: {
      filters: [],
      sorts: [{ direction: "desc", fieldSlug: "upside_pct" }],
      visibleFieldSlugs: [
        "ticker",
        "company",
        "sector",
        "price_usd",
        "price_hkd",
        "price_jpy",
        "price_combined_usd",
        "target_price_usd",
        "upside_pct",
        "signal",
        "watching",
      ],
    },
    minutesAgo: 78,
    useCases: ["stock-picking"],
  },
  {
    id: "viw_seed_stock_watchlist_buy",
    baseId: DEMO_STOCK_WATCHLIST_BASE_ID,
    slug: "buy-signals",
    name: "Buy signals",
    description: "Stocks whose formula-computed signal currently reads Buy.",
    config: {
      filters: [{ fieldSlug: "signal", operator: "equals", value: "Buy" }],
      sorts: [{ direction: "desc", fieldSlug: "upside_pct" }],
      visibleFieldSlugs: [
        "ticker",
        "company",
        "price_usd",
        "target_price_usd",
        "upside_pct",
        "signal",
      ],
    },
    minutesAgo: 77,
    useCases: ["stock-picking"],
  },
];
