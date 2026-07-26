// Demo scenario: an exhaustive coverage fixture for busabase's `formula`
// field type — one Base, one formula COLUMN per function in
// ../../domains/base/formula/functions/ (plus RECORD_ID and a chained
// formula-referencing-formula example), all evaluated against ONE seeded
// row of plain input columns. Same spirit as the existing "Field Type Lab"
// demo Base (one column per FIELD TYPE) but for formula FUNCTIONS.
//
// TODAY/NOW/FROMNOW/TONOW are deliberately excluded from the seeded row:
// their result depends on the moment the record is materialized, not on
// fixed input data, so there's no fixed "expected value" to hand-verify at
// seed-authoring time. They're covered by tests/formula-date-time.test.ts
// instead. CREATED_TIME/LAST_MODIFIED_TIME are excluded for the same
// reason (they resolve from the real seed run's timestamp, not from
// anything computable at module-load time) — also covered by
// tests/formula-record.test.ts. RECORD_ID *is* included: unlike the other
// record functions, its value is a literal this file already chooses.
import {
  evaluateFormula,
  type FormulaValue,
  serializeFormulaResult,
} from "../../domains/base/formula";
import type { SeedBaseDef, SeedFolderDef, SeedRecordDef, SeedViewDef } from "../seed-types";

export const DEMO_FORMULA_LAB_FOLDER_NODE_ID = "nod_formula_lab";
export const DEMO_FORMULA_LAB_BASE_ID = "bse_local_formula_lab";
export const DEMO_FORMULA_LAB_BASE_NODE_ID = "nod_base_formula_lab";
export const FORMULA_LAB_ROW_ID = "rec_seed_formula_lab_row1";
const FORMULA_LAB_ROW_COMMIT_ID = "cmt_seed_formula_lab_row1";

export const FORMULA_LAB_FOLDERS: SeedFolderDef[] = [
  {
    nodeId: DEMO_FORMULA_LAB_FOLDER_NODE_ID,
    slug: "formula-lab",
    name: "Formula Lab",
    description:
      "One formula column per supported function — a coverage fixture, not a realistic dataset.",
    position: 21,
  },
];

// Every formula field's expression, keyed by slug — a plain object (not
// inlined per-field) so `withComputedFormulas` below can evaluate every one
// of them with the SAME engine + SAME expression string used in the field
// definitions, guaranteeing the pre-baked seed value can never drift from
// what a real write would compute (same technique stock-picking.ts uses).
const FORMULA_EXPRESSIONS: Record<string, string> = {
  // numeric
  f_sum: "SUM({num_a}, {num_b}, {num_c})",
  f_average: "ROUND(AVERAGE({num_a}, {num_b}, {num_c}), 2)",
  f_min: "MIN({num_a}, {num_b}, {num_c})",
  f_max: "MAX({num_a}, {num_b}, {num_c})",
  f_abs: "ABS({num_b} - {num_a})",
  f_round: "ROUND({price} * {qty}, 2)",
  f_roundup: "ROUNDUP(4.12, 1)",
  f_rounddown: "ROUNDDOWN(4.19, 1)",
  f_count: "COUNT({num_a}, {text_a}, {num_b})",
  f_counta: 'COUNTA({num_a}, {text_a}, "")',
  f_countall: 'COUNTALL({num_a}, {text_a}, "")',
  f_countif: "COUNTIF({num_c}, {num_a}, {num_b}, {num_c})",
  f_ceiling: "CEILING(4.1)",
  f_floor: "FLOOR(4.9)",
  f_even: "EVEN(3)",
  f_odd: "ODD(4)",
  f_int: "INT(-1.5)",
  f_mod: "MOD({num_a}, {num_b})",
  f_power: "POWER({num_c}, 2)",
  f_sqrt: "SQRT(16)",
  f_exp: "EXP(0)",
  f_log: "LOG(100)",
  // logical
  f_if: 'IF({flag_a}, "Yes", "No")',
  f_and: "AND({flag_a}, {num_a} > 10)",
  f_or: "OR({flag_b}, {num_a} > 100)",
  f_not: "NOT({flag_b})",
  f_switch: 'SWITCH({num_c}, 1, "one", 3, "three", "other")',
  f_xor: "XOR({flag_a}, {flag_b})",
  f_iserror: "ISERROR(1 / 0)",
  f_error_caught: 'IF(ISERROR(1 / 0), "caught", "not caught")',
  f_blank: "BLANK()",
  f_true: "TRUE()",
  f_false: "FALSE()",
  // text
  f_concatenate: 'CONCATENATE({text_a}, " ", {text_b})',
  f_left: "LEFT({text_a}, 5)",
  f_right: "RIGHT({text_a}, 5)",
  f_mid: "MID({text_a}, 7, 5)",
  f_len: "LEN({text_a})",
  f_find: "FIND({text_b}, {text_a})",
  f_search: 'SEARCH("world", {text_a})',
  f_replace: 'REPLACE({text_a}, 1, 5, "Howdy")',
  f_substitute: 'SUBSTITUTE({text_a}, "o", "0")',
  f_rept: 'REPT("ab", 3)',
  f_trim: 'TRIM("  a   b  ")',
  f_upper: "UPPER({text_a})",
  f_lower: "LOWER({text_a})",
  f_t: "T({text_a})",
  f_value: 'VALUE("42.5")',
  f_encode_url: 'ENCODE_URL_COMPONENT("a b/c")',
  // date/time
  f_dateadd: 'DATEADD({date_a}, 10, "days")',
  f_datestr: "DATESTR({date_a})",
  f_timestr: "TIMESTR({date_a})",
  f_datetime_format: 'DATETIME_FORMAT({date_a}, "YYYY/MM/DD")',
  f_datetime_parse: 'DATETIME_PARSE("2026-03-01T00:00:00Z")',
  f_datetime_diff: 'DATETIME_DIFF({date_a}, {date_b}, "days")',
  f_day: "DAY({date_a})",
  f_month: "MONTH({date_a})",
  f_year: "YEAR({date_a})",
  f_hour: "HOUR({date_a})",
  f_minute: "MINUTE({date_a})",
  f_second: "SECOND({date_a})",
  f_weekday: "WEEKDAY({date_a})",
  f_weeknum: "WEEKNUM({date_a})",
  f_workday: "WORKDAY({date_a}, 5)",
  f_workday_diff: "WORKDAY_DIFF({date_a}, {date_b})",
  f_is_before: "IS_BEFORE({date_a}, {date_b})",
  f_is_after: "IS_AFTER({date_a}, {date_b})",
  f_is_same: "IS_SAME({date_a}, {date_a})",
  f_set_locale: 'SET_LOCALE("en-US")',
  f_set_timezone: 'SET_TIMEZONE("UTC")',
  // record
  f_record_id: "RECORD_ID()",
  // array (multiselect coerces to a string array — see field-types.ts's coerceForFormula)
  f_arrayjoin: "ARRAYJOIN({tags})",
  f_arrayjoin_sep: 'ARRAYJOIN({tags}, " | ")',
  f_arrayunique: "ARRAYUNIQUE({tags})",
  f_arraycompact: "ARRAYCOMPACT({tags})",
  f_arrayflatten: "ARRAYFLATTEN({tags}, {tags})",
  // chained: a formula referencing ANOTHER formula field (f_sum), proving the
  // dependency graph end to end in a real seeded record, not just unit tests.
  f_sum_doubled: "{f_sum} * 2",
};

const formulaLabFields = [
  {
    id: "bsf_lab_num_a",
    slug: "num_a",
    name: "Number A",
    type: "number",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_num_b",
    slug: "num_b",
    name: "Number B",
    type: "number",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_num_c",
    slug: "num_c",
    name: "Number C",
    type: "number",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_price",
    slug: "price",
    name: "Price",
    type: "number",
    required: false,
    options: {},
  },
  { id: "bsf_lab_qty", slug: "qty", name: "Qty", type: "number", required: false, options: {} },
  {
    id: "bsf_lab_text_a",
    slug: "text_a",
    name: "Text A",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_text_b",
    slug: "text_b",
    name: "Text B",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_date_a",
    slug: "date_a",
    name: "Date A",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_date_b",
    slug: "date_b",
    name: "Date B",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_flag_a",
    slug: "flag_a",
    name: "Flag A",
    type: "checkbox",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_flag_b",
    slug: "flag_b",
    name: "Flag B",
    type: "checkbox",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_tags",
    slug: "tags",
    name: "Tags",
    type: "multiselect",
    required: false,
    options: {
      choices: [
        { id: "red", name: "Red", color: "rose" },
        { id: "green", name: "Green", color: "emerald" },
        { id: "blue", name: "Blue", color: "sky" },
      ],
    },
  },
  // One `formula` field per FORMULA_EXPRESSIONS entry, in the same order.
  ...Object.entries(FORMULA_EXPRESSIONS).map(([slug, expression]) => ({
    id: `bsf_lab_${slug}`,
    slug,
    name: slug,
    type: "formula" as const,
    required: false,
    options: { formula: { expression } },
  })),
] satisfies SeedBaseDef["fields"];

export const FORMULA_LAB_BASES: SeedBaseDef[] = [
  {
    id: DEMO_FORMULA_LAB_BASE_ID,
    nodeId: DEMO_FORMULA_LAB_BASE_NODE_ID,
    slug: "formula-lab",
    name: "Formula Lab",
    description:
      "One formula column per supported function, evaluated against one fixed input row.",
    folderNodeId: DEMO_FORMULA_LAB_FOLDER_NODE_ID,
    useCases: ["formula-lab"],
    fields: formulaLabFields,
  },
];

// The seed/demo path (logic/seed.ts) writes commit fields directly and never
// runs field-types.ts's `compute` registry (see SPEC.md) — every formula
// value below is pre-baked by evaluating the SAME engine + SAME expression
// strings as the field definitions above, so it can never drift from what a
// real write would compute. `f_record_id` and `f_sum_doubled` (which chains
// off `f_sum`) are threaded through the same resolver as everything else —
// `f_sum` is computed first (object key order) and fed back in, mirroring
// field-rules.ts's topological compute order for a 2-level-deep chain.
const rawInputFields: Record<string, FormulaValue> = {
  num_a: 17,
  num_b: 5,
  num_c: 3,
  price: 19.99,
  qty: 3,
  text_a: "Hello World",
  text_b: "World",
  date_a: "2026-01-15",
  date_b: "2026-02-20",
  flag_a: true,
  flag_b: false,
  tags: ["red", "green", "blue"],
};

const withComputedFormulas = (): Record<string, FormulaValue> => {
  const values: Record<string, FormulaValue> = { ...rawInputFields };
  const resolveField = (slug: string): FormulaValue => {
    if (slug === "date_a" || slug === "date_b") {
      const raw = values[slug];
      return typeof raw === "string" ? new Date(raw) : (raw as FormulaValue);
    }
    return values[slug] ?? null;
  };
  for (const [slug, expression] of Object.entries(FORMULA_EXPRESSIONS)) {
    values[slug] =
      slug === "f_record_id"
        ? FORMULA_LAB_ROW_ID
        : serializeFormulaResult(
            evaluateFormula(expression, resolveField, {
              recordId: FORMULA_LAB_ROW_ID,
              createdAtIso: null,
              lastModifiedIso: null,
            }),
          );
  }
  return values;
};

export const FORMULA_LAB_RECORDS: SeedRecordDef[] = [
  {
    id: FORMULA_LAB_ROW_ID,
    baseId: DEMO_FORMULA_LAB_BASE_ID,
    commitId: FORMULA_LAB_ROW_COMMIT_ID,
    fields: withComputedFormulas(),
    message: "Seed formula-functions-lab coverage row",
    author: "seed-formula-lab",
    minutesAgo: 60,
    useCases: ["formula-lab"],
  },
];

export const FORMULA_LAB_VIEWS: SeedViewDef[] = [
  {
    id: "viw_seed_formula_lab_all",
    baseId: DEMO_FORMULA_LAB_BASE_ID,
    slug: "all",
    name: "All",
    description: "Every input column and every formula column.",
    config: {
      filters: [],
      sorts: [],
      visibleFieldSlugs: ["num_a", "num_b", "num_c", ...Object.keys(FORMULA_EXPRESSIONS)],
    },
    minutesAgo: 58,
    useCases: ["formula-lab"],
  },
];
