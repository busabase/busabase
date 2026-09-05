/**
 * Copy-pasteable Agent prompts, scoped to one node.
 *
 * Two deliberately different tiers (see `PromptTier`):
 *
 * - **capability** — grouped by what the prompt acts on (Content, Records, Fields,
 *   etc.). Most entries are derived straight from the node-type registry; a small
 *   set of type-specific, curated helpers can sit alongside those operations when
 *   the registry has no matching operation, such as reading a Doc without changing
 *   it.
 *
 * - **scenario** — human-shaped and *curated*: task-level things people actually
 *   ask for ("import a batch of data", "design the schema for me"), which usually
 *   span several operations. Hand-written per node type, and only for the types
 *   where it earns its keep; a type with no scenarios simply shows the capability
 *   tier.
 *
 * Every prompt is rendered with the concrete node + space already interpolated, so
 * the agent can locate the target without guessing.
 */

import {
  type CustomAgentPrompts,
  type CustomPromptDef,
  customAgentPromptsSchema,
} from "busabase-contract/contract/node-agent-prompt-schemas";
import {
  GENERIC_NODE_OPERATION_KINDS,
  getNodeType,
  listNodeTypes,
} from "busabase-contract/domains";
import { iStringParse } from "openlib/i18n/i-string";
import type { CoreLocale } from "../../../i18n";
import type { CoreI18nMessages } from "../../../i18n/messages";
import { operationLabelKeys } from "./change-request";

export type PromptTier = "scenario" | "capability";

/**
 * What inside the node the prompts are about.
 *
 * The dialog is the same one at every level — what changes is the target line
 * (so the agent knows it is being pointed at ONE column or ONE record, not the
 * whole table) and which slice of the prompt set is worth showing there. A
 * column-level prompt listing "create a view" would just be noise.
 */
export type NodePromptScope =
  | { kind: "node" }
  | { kind: "field"; fieldName: string; fieldSlug: string; fieldType?: string }
  | { kind: "record"; recordId: string; recordTitle?: string }
  /**
   * ONE cell — this record's value for this field. Not the same as `field`
   * (that one means the column across every record) nor `record` (that one
   * means every field of this row); it is their intersection, and it is what
   * someone means when they point at a value on the record page and say "make
   * the agent change THIS".
   */
  | {
      kind: "cell";
      recordId: string;
      recordTitle?: string;
      fieldName: string;
      fieldSlug: string;
      fieldType?: string;
    };

export interface NodePromptContext {
  nodeType: string;
  nodeName: string;
  nodeId: string;
  spaceName?: string;
  spaceId?: string;
  /** Defaults to the whole node. */
  scope?: NodePromptScope;
  /**
   * This node's custom scenario prompts, already fetched and validated by the
   * caller (`nodes.getAgentPrompts`), REPLACING the node type's defaults.
   *
   * Optional and safe to omit — that is also what a caller passes while the
   * fetch is still in flight — and the node then shows its type's default
   * scenarios, exactly as it did before this field existed. It used to be the
   * node's whole `metadata` bag with this key dug out of it; the value now has
   * its own column and its own read, so the bag is no longer involved.
   */
  customPrompts?: CustomAgentPrompts;
}

export interface NodePrompt {
  /** Stable key — used for list selection and as the copy-state key. */
  key: string;
  tier: PromptTier;
  /** Localized, human-readable label shown in the list. */
  label: string;
  /** Localized group heading ("Records", "Fields", …) the list buckets this under. */
  group: string;
  /** The final, fully-interpolated text the user copies. */
  body: string;
}

// ── Shared framing ────────────────────────────────────────────────────────────

/** Per-locale sentence naming the target node, plus the space when we know it. */
const TARGET_LINE: Record<CoreLocale, (c: NodePromptContext, typeLabel: string) => string> = {
  en: (c, typeLabel) =>
    `Target: the Busabase ${typeLabel} "${c.nodeName}" (nodeId: ${c.nodeId})` +
    (c.spaceId ? `, in space "${c.spaceName ?? c.spaceId}" (spaceId: ${c.spaceId})` : "") +
    ".",
  "zh-CN": (c, typeLabel) =>
    `目标：Busabase 的 ${typeLabel}「${c.nodeName}」（nodeId: ${c.nodeId}）` +
    (c.spaceId ? `，位于空间「${c.spaceName ?? c.spaceId}」（spaceId: ${c.spaceId}）` : "") +
    "。",
  "zh-TW": (c, typeLabel) =>
    `目標：Busabase 的 ${typeLabel}「${c.nodeName}」（nodeId: ${c.nodeId}）` +
    (c.spaceId ? `，位於空間「${c.spaceName ?? c.spaceId}」（spaceId: ${c.spaceId}）` : "") +
    "。",
  ja: (c, typeLabel) =>
    `対象：Busabase の ${typeLabel}「${c.nodeName}」（nodeId: ${c.nodeId}）` +
    (c.spaceId ? `、スペース「${c.spaceName ?? c.spaceId}」（spaceId: ${c.spaceId}）内` : "") +
    "。",
};

type ScopeOf<K extends NodePromptScope["kind"]> = Extract<NodePromptScope, { kind: K }>;

/**
 * Appended to the target line when the prompt is about one column, one record or
 * one cell rather than the whole node. Kept as a separate sentence (instead of
 * folded into `TARGET_LINE`) so both halves stay readable and the node-level
 * wording is byte-identical to what it has always been.
 *
 * Every one of these is phrased as a FENCE ("leave every other … alone"), not
 * just a pointer. Naming the target tells the agent where to start; the fence is
 * what stops a "clean up this value" from turning into a sweep of the column.
 */

/** One builder per narrowing scope. `node` adds nothing, so it has no entry. */
interface ScopeLineBuilders {
  field: (scope: ScopeOf<"field">) => string;
  record: (scope: ScopeOf<"record">) => string;
  cell: (scope: ScopeOf<"cell">) => string;
}

const SCOPE_LINES: Record<CoreLocale, ScopeLineBuilders> = {
  en: {
    field: (s) =>
      ` Work on ONE field only: "${s.fieldName}" (fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `, type: ${s.fieldType}` : ""
      }). Leave every other field alone.`,
    record: (s) =>
      ` Work on ONE record only: ${s.recordTitle ? `"${s.recordTitle}" ` : ""}(recordId: ${
        s.recordId
      }). Leave every other record alone.`,
    cell: (s) =>
      ` Work on ONE value only: the "${s.fieldName}" field (fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `, type: ${s.fieldType}` : ""
      }) of the record ${s.recordTitle ? `"${s.recordTitle}" ` : ""}(recordId: ${
        s.recordId
      }). Do not touch any other field of this record, and do not touch this field on any other record.`,
  },
  "zh-CN": {
    field: (s) =>
      ` 只处理其中一个字段：「${s.fieldName}」（fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `，类型：${s.fieldType}` : ""
      }），其他字段一律不要动。`,
    record: (s) =>
      ` 只处理其中一条记录：${s.recordTitle ? `「${s.recordTitle}」` : ""}（recordId: ${
        s.recordId
      }），其他记录一律不要动。`,
    cell: (s) =>
      ` 只处理其中一个值：记录 ${s.recordTitle ? `「${s.recordTitle}」` : ""}（recordId: ${
        s.recordId
      }）的「${s.fieldName}」字段（fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `，类型：${s.fieldType}` : ""
      }）。这条记录的其他字段不要动，其他记录的这个字段也不要动。`,
  },
  "zh-TW": {
    field: (s) =>
      ` 只處理其中一個欄位：「${s.fieldName}」（fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `，型別：${s.fieldType}` : ""
      }），其他欄位一律不要動。`,
    record: (s) =>
      ` 只處理其中一筆記錄：${s.recordTitle ? `「${s.recordTitle}」` : ""}（recordId: ${
        s.recordId
      }），其他記錄一律不要動。`,
    cell: (s) =>
      ` 只處理其中一個值：記錄 ${s.recordTitle ? `「${s.recordTitle}」` : ""}（recordId: ${
        s.recordId
      }）的「${s.fieldName}」欄位（fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `，型別：${s.fieldType}` : ""
      }）。這筆記錄的其他欄位不要動，其他記錄的這個欄位也不要動。`,
  },
  ja: {
    field: (s) =>
      ` 対象はフィールド 1 つだけです：「${s.fieldName}」（fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `、型：${s.fieldType}` : ""
      }）。他のフィールドには触れないでください。`,
    record: (s) =>
      ` 対象はレコード 1 件だけです：${s.recordTitle ? `「${s.recordTitle}」` : ""}（recordId: ${
        s.recordId
      }）。他のレコードには触れないでください。`,
    cell: (s) =>
      ` 対象は値 1 つだけです：レコード ${s.recordTitle ? `「${s.recordTitle}」` : ""}（recordId: ${
        s.recordId
      }）の「${s.fieldName}」フィールド（fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `、型：${s.fieldType}` : ""
      }）。このレコードの他のフィールドにも、他のレコードのこのフィールドにも触れないでください。`,
  },
};

const scopeLine = (locale: CoreLocale, scope: NodePromptScope): string => {
  const builders = SCOPE_LINES[locale];
  switch (scope.kind) {
    case "field":
      return builders.field(scope);
    case "record":
      return builders.record(scope);
    case "cell":
      return builders.cell(scope);
    default:
      return "";
  }
};

/**
 * Mutating prompts ask the agent not to self-approve. Reply-language
 * guidance is separate because read-only prompts need it without accidentally
 * asking the agent to create a change.
 */
const APPROVAL_POLICY: Record<CoreLocale, string> = {
  en: "Submit the change as a ChangeRequest and never merge it without my approval.",
  "zh-CN": "以 ChangeRequest 提交改动，未经我批准绝不要合并。",
  "zh-TW": "以 ChangeRequest 提交變更，未經我核准絕不要合併。",
  ja: "変更は ChangeRequest として提出し、私の承認なしに絶対にマージしないでください。",
};

const REPLY_LANGUAGE: Record<CoreLocale, string> = {
  en: "Reply to me in English.",
  "zh-CN": "请用简体中文回复我。",
  "zh-TW": "請用繁體中文回覆我。",
  ja: "日本語で返信してください。",
};

/** Capability tier: one template per locale, filled with the translated op label. */
const CAPABILITY_TEMPLATE: Record<CoreLocale, (target: string, opLabel: string) => string> = {
  en: (target, opLabel) =>
    `${target}\n\nPerform this operation: ${opLabel}.\nInspect the node's current state first, then ask me for anything you still need.`,
  "zh-CN": (target, opLabel) =>
    `${target}\n\n请执行操作：${opLabel}。\n先查看该节点的当前状态，还缺什么信息就直接问我。`,
  "zh-TW": (target, opLabel) =>
    `${target}\n\n請執行操作：${opLabel}。\n先查看該節點的目前狀態，還缺什麼資訊就直接問我。`,
  ja: (target, opLabel) =>
    `${target}\n\n次の操作を実行してください：${opLabel}。\nまずノードの現在の状態を確認し、足りない情報があれば私に聞いてください。`,
};

// ── Capability grouping ───────────────────────────────────────────────────────

/**
 * Which group heading an operation falls under. Keyed by the operation kind's
 * prefix so a plugin type's `myplugin_*` operations bucket under their own type
 * label instead of silently landing in "General".
 */
type GroupKey = "record" | "field" | "view" | "content" | "node" | "other";

const GROUP_LABELS: Record<CoreLocale, Record<GroupKey, string>> = {
  en: {
    record: "Records",
    field: "Fields",
    view: "Views",
    content: "Content",
    node: "General",
    other: "Other",
  },
  "zh-CN": {
    record: "记录",
    field: "字段",
    view: "视图",
    content: "内容",
    node: "通用",
    other: "其他",
  },
  "zh-TW": {
    record: "記錄",
    field: "欄位",
    view: "檢視",
    content: "內容",
    node: "通用",
    other: "其他",
  },
  ja: {
    record: "レコード",
    field: "フィールド",
    view: "ビュー",
    content: "コンテンツ",
    node: "共通",
    other: "その他",
  },
};

const groupOf = (kind: string): GroupKey => {
  if (kind.startsWith("record_")) return "record";
  if (kind.startsWith("view_")) return "view";
  if (kind.startsWith("node_")) return "node";
  if (kind.includes("_field")) return "field";
  if (kind.includes("_file") || kind.endsWith("_update") || kind.includes("_metadata")) {
    return "content";
  }
  return "other";
};

/** Display order of the groups in the capability list. */
const GROUP_ORDER: GroupKey[] = ["record", "field", "view", "content", "other", "node"];

// ── Scenario tier (curated) ───────────────────────────────────────────────────

/**
 * Hand-written, task-shaped prompts per node type. Only the types where a
 * curated prompt genuinely beats the mechanical capability list are listed;
 * everything else falls through to the capability tier alone.
 *
 * `body` receives the already-built target line so every curated prompt stays
 * consistent about how it names the node.
 */
interface PromptDef {
  key: string;
  /** Defaults to `change` so a new prompt cannot silently bypass approval. */
  intent?: "read-only" | "change";
  label: Record<CoreLocale, string>;
  body: Record<CoreLocale, (target: string) => string>;
}

const BASE_SCENARIOS: PromptDef[] = [
  {
    key: "base-bulk-import",
    label: {
      en: "Bulk-add records",
      "zh-CN": "批量录入数据",
      "zh-TW": "批次錄入資料",
      ja: "レコードを一括追加",
    },
    body: {
      en: (t) =>
        `${t}\n\nI want to bulk-add records. Read the field schema first, then map what I give you onto those fields. Flag anything that looks like a duplicate of an existing record and ask me before writing it.`,
      "zh-CN": (t) =>
        `${t}\n\n我要批量录入数据。请先读取字段结构，再把我给你的内容按字段对应填好。遇到疑似和已有记录重复的，先问我再写入。`,
      "zh-TW": (t) =>
        `${t}\n\n我要批次錄入資料。請先讀取欄位結構，再把我給你的內容按欄位對應填好。遇到疑似和既有記錄重複的，先問我再寫入。`,
      ja: (t) =>
        `${t}\n\nレコードを一括で追加したいです。まずフィールド構成を読み取り、私が渡す内容を各フィールドに対応付けてください。既存レコードと重複しそうなものは、書き込む前に私に確認してください。`,
    },
  },
  {
    key: "base-design-schema",
    label: {
      en: "Design the schema for me",
      "zh-CN": "帮我设计表结构",
      "zh-TW": "幫我設計表結構",
      ja: "スキーマを設計してもらう",
    },
    body: {
      en: (t) =>
        `${t}\n\nI'll describe what I need to track. Propose a field schema for it — field names, types, and why each one — and show me the proposal before creating or changing any field.`,
      "zh-CN": (t) =>
        `${t}\n\n我会描述我要记录什么。请据此设计字段结构——字段名、类型、以及每个字段的理由——先把方案给我看，我确认后再新建或修改字段。`,
      "zh-TW": (t) =>
        `${t}\n\n我會描述我要記錄什麼。請據此設計欄位結構——欄位名、型別、以及每個欄位的理由——先把方案給我看，我確認後再新增或修改欄位。`,
      ja: (t) =>
        `${t}\n\n何を管理したいかを説明します。それに合うフィールド構成（名前・型・各フィールドの理由）を提案し、実際に作成・変更する前に必ず案を見せてください。`,
    },
  },
  {
    key: "base-dedupe",
    label: {
      en: "Find and clean duplicates",
      "zh-CN": "清理重复记录",
      "zh-TW": "清理重複記錄",
      ja: "重複レコードを整理",
    },
    body: {
      en: (t) =>
        `${t}\n\nScan the records for duplicates and near-duplicates. List what you found and how you'd merge or remove each group — don't change anything until I pick.`,
      "zh-CN": (t) =>
        `${t}\n\n请扫描记录里的重复项和近似重复项。列出你找到的分组，以及每组你打算怎么合并或删除——在我挑选之前不要动任何数据。`,
      "zh-TW": (t) =>
        `${t}\n\n請掃描記錄裡的重複項和近似重複項。列出你找到的分組，以及每組你打算怎麼合併或刪除——在我挑選之前不要動任何資料。`,
      ja: (t) =>
        `${t}\n\nレコード内の重複・類似重複を洗い出してください。見つかったグループと、それぞれをどう統合・削除するつもりかを提示し、私が選ぶまでは何も変更しないでください。`,
    },
  },
  {
    key: "base-summarize",
    intent: "read-only",
    label: {
      en: "Summarize and report",
      "zh-CN": "汇总分析并出报告",
      "zh-TW": "彙總分析並出報告",
      ja: "集計してレポート",
    },
    body: {
      en: (t) =>
        `${t}\n\nRead the records and give me a summary: the key numbers, notable patterns, and anything that looks off. This is read-only — don't modify the data.`,
      "zh-CN": (t) =>
        `${t}\n\n请阅读记录并给我一份总结：关键数字、值得注意的规律、以及看起来不对劲的地方。这是只读任务——不要修改数据。`,
      "zh-TW": (t) =>
        `${t}\n\n請閱讀記錄並給我一份總結：關鍵數字、值得注意的規律、以及看起來不對勁的地方。這是唯讀任務——不要修改資料。`,
      ja: (t) =>
        `${t}\n\nレコードを読んで要約してください：主要な数値、目立つ傾向、そして違和感のある点。これは読み取り専用です——データを変更しないでください。`,
    },
  },
];

const DOC_READ_PROMPT: PromptDef = {
  key: "doc-read",
  intent: "read-only",
  label: {
    en: "Read doc",
    "zh-CN": "读取文档",
    "zh-TW": "讀取文件",
    ja: "文書を読む",
  },
  body: {
    en: (t) =>
      `${t}\n\nRead this document's current content in full and keep it in context for my next request. This is a read-only task: do not modify the document, create a ChangeRequest, or merge anything. After reading it, briefly confirm that you are ready.`,
    "zh-CN": (t) =>
      `${t}\n\n请完整读取这篇文档的当前内容，并将它保留为我下一步要求的上下文。这是只读任务：不要修改文档，不要创建 ChangeRequest，也不要合并任何内容。读完后，简短确认你已经准备好。`,
    "zh-TW": (t) =>
      `${t}\n\n請完整讀取這篇文件的目前內容，並將它保留為我下一步要求的上下文。這是唯讀任務：不要修改文件，不要建立 ChangeRequest，也不要合併任何內容。讀完後，簡短確認你已經準備好。`,
    ja: (t) =>
      `${t}\n\nこの文書の現在の内容をすべて読み、次の依頼のためにコンテキストとして保持してください。これは読み取り専用のタスクです。文書を変更したり、ChangeRequest を作成したり、何かをマージしたりしないでください。読み終えたら、準備ができたことを簡潔に確認してください。`,
  },
};

const DOC_SCENARIOS: PromptDef[] = [
  {
    key: "doc-draft",
    label: {
      en: "Draft / expand this doc",
      "zh-CN": "起草或扩写这篇文档",
      "zh-TW": "起草或擴寫這篇文件",
      ja: "この文書を起草・加筆",
    },
    body: {
      en: (t) =>
        `${t}\n\nRead the current content, then draft or expand it based on what I tell you next. Keep the existing structure and tone unless I ask otherwise.`,
      "zh-CN": (t) =>
        `${t}\n\n请先读当前内容，再根据我接下来的要求起草或扩写。除非我另有要求，保持现有的结构和语气。`,
      "zh-TW": (t) =>
        `${t}\n\n請先讀目前內容，再根據我接下來的要求起草或擴寫。除非我另有要求，保持現有的結構和語氣。`,
      ja: (t) =>
        `${t}\n\n現在の内容を読んだうえで、次に伝える要件に沿って起草・加筆してください。特に指示がなければ既存の構成とトーンを保ってください。`,
    },
  },
  {
    key: "doc-review",
    label: {
      en: "Review and suggest edits",
      "zh-CN": "审阅并提出修改建议",
      "zh-TW": "審閱並提出修改建議",
      ja: "レビューして修正案を出す",
    },
    body: {
      en: (t) =>
        `${t}\n\nReview this doc for clarity, gaps, and anything factually shaky. Give me the suggested edits as a list first — don't rewrite it until I say which ones to apply.`,
      "zh-CN": (t) =>
        `${t}\n\n请从清晰度、缺漏、以及事实站不住脚的地方审阅这篇文档。先以列表形式给我修改建议——在我指定采纳哪些之前不要直接改写。`,
      "zh-TW": (t) =>
        `${t}\n\n請從清晰度、缺漏、以及事實站不住腳的地方審閱這篇文件。先以列表形式給我修改建議——在我指定採納哪些之前不要直接改寫。`,
      ja: (t) =>
        `${t}\n\nこの文書を明確さ・抜け漏れ・事実として怪しい点の観点でレビューしてください。まず修正案をリストで提示し、どれを適用するか私が指定するまで書き換えないでください。`,
    },
  },
];

const DRIVE_SCENARIOS: PromptDef[] = [
  {
    key: "drive-organize",
    label: {
      en: "Organize these files",
      "zh-CN": "整理这些文件",
      "zh-TW": "整理這些檔案",
      ja: "ファイルを整理",
    },
    body: {
      en: (t) =>
        `${t}\n\nList what's in here, then propose a cleaner structure — naming and grouping. Show me the plan before moving or renaming anything.`,
      "zh-CN": (t) =>
        `${t}\n\n请列出里面有什么，然后提出更清晰的组织方式——命名和分组。在移动或重命名任何东西之前，先把方案给我看。`,
      "zh-TW": (t) =>
        `${t}\n\n請列出裡面有什麼，然後提出更清晰的組織方式——命名和分組。在移動或重新命名任何東西之前，先把方案給我看。`,
      ja: (t) =>
        `${t}\n\n中身を一覧にしたうえで、より整理された構成（命名とグループ分け）を提案してください。移動や名前変更を行う前に必ず計画を見せてください。`,
    },
  },
  {
    key: "drive-summarize",
    intent: "read-only",
    label: {
      en: "Summarize the contents",
      "zh-CN": "总结文件内容",
      "zh-TW": "總結檔案內容",
      ja: "内容を要約",
    },
    body: {
      en: (t) =>
        `${t}\n\nRead through the files and tell me what's in here — what each one is for, and anything outdated or redundant. Read-only.`,
      "zh-CN": (t) =>
        `${t}\n\n请通读这些文件，告诉我里面都有什么——每个文件是做什么的，以及哪些已经过时或冗余。只读，不要改动。`,
      "zh-TW": (t) =>
        `${t}\n\n請通讀這些檔案，告訴我裡面都有什麼——每個檔案是做什麼的，以及哪些已經過時或冗餘。唯讀，不要改動。`,
      ja: (t) =>
        `${t}\n\nファイルを一通り読んで、何が入っているか教えてください——各ファイルの用途、そして古くなっている/重複しているもの。読み取り専用です。`,
    },
  },
];

const SKILL_SCENARIOS: PromptDef[] = [
  {
    key: "skill-improve",
    label: {
      en: "Improve this skill",
      "zh-CN": "改进这个 Skill",
      "zh-TW": "改進這個 Skill",
      ja: "この Skill を改善",
    },
    body: {
      en: (t) =>
        `${t}\n\nRead this skill's files and tell me where the instructions are ambiguous, missing, or likely to be misread by an agent. Propose concrete edits before changing anything.`,
      "zh-CN": (t) =>
        `${t}\n\n请读这个 skill 的文件，告诉我哪些指令含糊、缺失、或容易被 agent 误读。先提出具体修改建议，再动手改。`,
      "zh-TW": (t) =>
        `${t}\n\n請讀這個 skill 的檔案，告訴我哪些指令含糊、缺失、或容易被 agent 誤讀。先提出具體修改建議，再動手改。`,
      ja: (t) =>
        `${t}\n\nこの skill のファイルを読み、指示が曖昧・不足・エージェントに誤読されやすい箇所を指摘してください。変更する前に具体的な修正案を提示してください。`,
    },
  },
];

const AIRAPP_SCENARIOS: PromptDef[] = [
  {
    key: "airapp-add-feature",
    label: {
      en: "Add a feature",
      "zh-CN": "加一个功能",
      "zh-TW": "加一個功能",
      ja: "機能を追加",
    },
    body: {
      en: (t) =>
        `${t}\n\nRead the app's current source, then add the feature I describe next. Tell me which files you'll touch before you start.`,
      "zh-CN": (t) =>
        `${t}\n\n请先读这个应用的现有代码，再实现我接下来描述的功能。动手前先告诉我你打算改哪些文件。`,
      "zh-TW": (t) =>
        `${t}\n\n請先讀這個應用的現有程式碼，再實作我接下來描述的功能。動手前先告訴我你打算改哪些檔案。`,
      ja: (t) =>
        `${t}\n\nこのアプリの既存コードを読んでから、次に説明する機能を実装してください。着手前に変更予定のファイルを教えてください。`,
    },
  },
  {
    key: "airapp-debug",
    label: {
      en: "Debug a problem",
      "zh-CN": "排查一个问题",
      "zh-TW": "排查一個問題",
      ja: "不具合を調査",
    },
    body: {
      en: (t) =>
        `${t}\n\nI'll describe what's going wrong. Read the source, find the actual cause, and explain it to me before you fix anything.`,
      "zh-CN": (t) =>
        `${t}\n\n我会描述出了什么问题。请读代码找出真正的原因，先讲清楚给我听，再动手修。`,
      "zh-TW": (t) =>
        `${t}\n\n我會描述出了什麼問題。請讀程式碼找出真正的原因，先講清楚給我聽，再動手修。`,
      ja: (t) =>
        `${t}\n\n何が起きているかを説明します。コードを読んで本当の原因を突き止め、修正する前に私に説明してください。`,
    },
  },
];

/**
 * Form is the node type that needs these MOST, and it used to be the one type
 * with none: a Form's page is authored by an agent as a single HTML document
 * (see `form-detail-view.tsx`) and there is deliberately no drag-and-drop
 * builder, so "ask your agent" is not one way to edit a form — it is the only
 * way. Falling through to the capability list alone told a user which
 * operations exist without ever saying "you can just ask for a different
 * layout".
 */
const FORM_SCENARIOS: PromptDef[] = [
  {
    key: "form-customize-page",
    label: {
      en: "Redesign this form's page",
      "zh-CN": "帮我定制这个表单",
      "zh-TW": "幫我定制這個表單",
      ja: "このフォームのページを作り直す",
    },
    body: {
      en: (t) =>
        `${t}\n\nRead the form's current page source and its field bindings first. Then redesign the page the way I describe next — layout, wording, grouping, and validation hints. Keep every existing field binding working unless I explicitly ask you to change one, and show me the new page before submitting it.`,
      "zh-CN": (t) =>
        `${t}\n\n请先读这个表单当前的页面源码和字段绑定，然后按我接下来的描述重新设计这个页面——排版、文案、分组、填写提示。除非我明确要求，否则所有已有的字段绑定都要保持可用；提交前先把新页面给我看。`,
      "zh-TW": (t) =>
        `${t}\n\n請先讀這個表單目前的頁面原始碼和欄位綁定，然後按我接下來的描述重新設計這個頁面——排版、文案、分組、填寫提示。除非我明確要求，否則所有既有的欄位綁定都要保持可用；提交前先把新頁面給我看。`,
      ja: (t) =>
        `${t}\n\nまずこのフォームの現在のページソースとフィールドバインディングを読んでください。そのうえで、次に説明する内容に沿ってページを作り直してください——レイアウト、文言、グルーピング、入力ヒント。私が明示的に頼まない限り既存のバインディングはすべて動くまま保ち、提出前に新しいページを見せてください。`,
    },
  },
  {
    key: "form-bindings",
    label: {
      en: "Change which fields it collects",
      "zh-CN": "改这个表单收集哪些字段",
      "zh-TW": "改這個表單收集哪些欄位",
      ja: "収集するフィールドを変える",
    },
    body: {
      en: (t) =>
        `${t}\n\nShow me which fields of the target base this form currently writes to, and which of the base's fields it ignores. Then adjust the bindings as I describe — added fields need a matching input on the page, and a removed one must not leave an orphaned input behind.`,
      "zh-CN": (t) =>
        `${t}\n\n请先告诉我这个表单目前写入目标数据表的哪些字段、又漏掉了哪些字段。然后按我的描述调整绑定——新增的字段要在页面上配一个对应的输入框，删掉的字段不能在页面上留下没人接收的输入框。`,
      "zh-TW": (t) =>
        `${t}\n\n請先告訴我這個表單目前寫入目標資料表的哪些欄位、又漏掉了哪些欄位。然後按我的描述調整綁定——新增的欄位要在頁面上配一個對應的輸入框，刪掉的欄位不能在頁面上留下沒人接收的輸入框。`,
      ja: (t) =>
        `${t}\n\nこのフォームが対象ベースのどのフィールドに書き込んでいて、どのフィールドを無視しているかを先に教えてください。そのうえで私の説明に沿ってバインディングを調整してください——追加したフィールドにはページ上の入力欄が必要で、削除したフィールドの入力欄を孤立させたまま残してはいけません。`,
    },
  },
  {
    key: "form-review-submissions",
    label: {
      en: "Review the pending submissions",
      "zh-CN": "审阅待处理的表单提交",
      "zh-TW": "審閱待處理的表單提交",
      ja: "保留中の送信を確認",
    },
    body: {
      en: (t) =>
        `${t}\n\nEvery submission of this form arrives as a pending ChangeRequest rather than a direct write. Go through the ones still awaiting review, summarize what each one wants to add, and flag anything that looks like spam, a duplicate, or a filled-in field that contradicts the rest. Recommend accept/reject per submission — I make the call, you don't merge.`,
      "zh-CN": (t) =>
        `${t}\n\n这个表单的每一次提交都是一条待审批的 ChangeRequest，不是直接写库。请把还没审的逐条过一遍，总结每条想新增什么，并标出疑似垃圾提交、重复提交、或者字段之间自相矛盾的内容。逐条给出通过/驳回的建议——由我拍板，你不要合并。`,
      "zh-TW": (t) =>
        `${t}\n\n這個表單的每一次提交都是一筆待審批的 ChangeRequest，不是直接寫庫。請把還沒審的逐筆過一遍，總結每筆想新增什麼，並標出疑似垃圾提交、重複提交、或者欄位之間自相矛盾的內容。逐筆給出通過/駁回的建議——由我拍板，你不要合併。`,
      ja: (t) =>
        `${t}\n\nこのフォームへの送信は直接書き込みではなく、すべて未承認の ChangeRequest として届きます。まだレビューされていないものを一つずつ確認し、それぞれが何を追加しようとしているか要約し、スパム・重複・他の項目と矛盾する入力を指摘してください。承認/却下の推奨を件ごとに出してください——判断は私がします。マージはしないでください。`,
    },
  },
];

const SCENARIOS_BY_TYPE: Record<string, PromptDef[]> = {
  base: BASE_SCENARIOS,
  doc: DOC_SCENARIOS,
  drive: DRIVE_SCENARIOS,
  skill: SKILL_SCENARIOS,
  airapp: AIRAPP_SCENARIOS,
  form: FORM_SCENARIOS,
};

/** Curated prompts that belong in a capability group rather than Scenarios. */
const CONTENT_PROMPTS_BY_TYPE: Partial<Record<string, PromptDef[]>> = {
  doc: [DOC_READ_PROMPT],
};

/**
 * Scenarios for a single COLUMN. Independent of node type — only a Base has
 * fields, and these are what people actually ask an agent to do to one.
 */
const FIELD_SCENARIOS: PromptDef[] = [
  {
    key: "field-clean-values",
    label: {
      en: "Clean up this column's values",
      "zh-CN": "清洗这一列的值",
      "zh-TW": "清洗這一欄的值",
      ja: "この列の値を整える",
    },
    body: {
      en: (t) =>
        `${t}\n\nRead this column across all records and normalize it: consistent casing, spacing, units and formatting, obvious typos fixed. List the changes you intend to make, grouped by the kind of problem, before writing anything.`,
      "zh-CN": (t) =>
        `${t}\n\n请通读所有记录里这一列的值并做归一化：大小写、空格、单位、格式统一，明显的错别字修掉。写入之前先按问题类型分组，列出你打算做的改动。`,
      "zh-TW": (t) =>
        `${t}\n\n請通讀所有記錄裡這一欄的值並做歸一化：大小寫、空格、單位、格式統一，明顯的錯字修掉。寫入之前先按問題類型分組，列出你打算做的改動。`,
      ja: (t) =>
        `${t}\n\n全レコードのこの列を読み、表記を統一してください：大文字小文字・空白・単位・書式の統一、明らかな誤字の修正。書き込む前に、問題の種類ごとにまとめて変更予定を提示してください。`,
    },
  },
  {
    key: "field-fill-blanks",
    label: {
      en: "Fill in the blanks",
      "zh-CN": "补全这一列的空值",
      "zh-TW": "補全這一欄的空值",
      ja: "空欄を埋める",
    },
    body: {
      en: (t) =>
        `${t}\n\nFind the records where this field is empty. For each one, work out a value from the record's OTHER fields and tell me where you got it. If a record doesn't have enough information, leave it empty and say so — do not guess.`,
      "zh-CN": (t) =>
        `${t}\n\n请找出这个字段为空的记录。对每一条，从该记录的其他字段推出一个值，并说明你的依据。如果某条记录信息不足，就留空并告诉我——不要猜。`,
      "zh-TW": (t) =>
        `${t}\n\n請找出這個欄位為空的記錄。對每一筆，從該記錄的其他欄位推出一個值，並說明你的依據。如果某筆記錄資訊不足，就留空並告訴我——不要猜。`,
      ja: (t) =>
        `${t}\n\nこのフィールドが空のレコードを探してください。各レコードについて、他のフィールドから値を導き、その根拠を示してください。情報が足りないレコードは空のままにして、その旨を伝えてください——推測はしないでください。`,
    },
  },
  {
    key: "field-audit",
    intent: "read-only",
    label: {
      en: "Audit this column for bad data",
      "zh-CN": "检查这一列有没有脏数据",
      "zh-TW": "檢查這一欄有沒有髒資料",
      ja: "この列の異常値を洗い出す",
    },
    body: {
      en: (t) =>
        `${t}\n\nGo through this column and report what looks wrong: values that don't fit the field's type or intent, outliers, duplicates that should be one value, and anything that reads like a placeholder. Read-only — report first, change nothing.`,
      "zh-CN": (t) =>
        `${t}\n\n请过一遍这一列，报告看起来不对的地方：不符合字段类型或用途的值、异常值、本该是同一个值的重复写法、以及看起来像占位符的内容。只读——先出报告，什么都别改。`,
      "zh-TW": (t) =>
        `${t}\n\n請過一遍這一欄，報告看起來不對的地方：不符合欄位型別或用途的值、異常值、本該是同一個值的重複寫法、以及看起來像佔位符的內容。唯讀——先出報告，什麼都別改。`,
      ja: (t) =>
        `${t}\n\nこの列を一通り確認し、おかしいと思われる箇所を報告してください：フィールドの型や意図に合わない値、外れ値、本来は同一であるべき表記ゆれ、プレースホルダーに見えるもの。読み取り専用——まず報告し、何も変更しないでください。`,
    },
  },
  {
    key: "field-redesign",
    label: {
      en: "Change this column's type or options",
      "zh-CN": "改这一列的类型或选项",
      "zh-TW": "改這一欄的型別或選項",
      ja: "この列の型・選択肢を変える",
    },
    body: {
      en: (t) =>
        `${t}\n\nI want to change how this field is defined — its type, its options, or whether it's required. Read the values that are already in it, tell me what would be lost or need converting, and wait for my go-ahead before changing the schema.`,
      "zh-CN": (t) =>
        `${t}\n\n我想改这个字段的定义——类型、选项、或者是否必填。请先读现有的值，告诉我改了之后哪些数据会丢失或需要转换，等我点头再动表结构。`,
      "zh-TW": (t) =>
        `${t}\n\n我想改這個欄位的定義——型別、選項、或者是否必填。請先讀現有的值，告訴我改了之後哪些資料會遺失或需要轉換，等我點頭再動表結構。`,
      ja: (t) =>
        `${t}\n\nこのフィールドの定義——型、選択肢、必須かどうか——を変更したいです。既存の値を読み、変更によって失われるもの・変換が必要なものを教えてください。スキーマの変更は私の承認を待ってから行ってください。`,
    },
  },
];

/**
 * Scenarios for a single CELL, opened from a property row on the record page.
 *
 * Deliberately the narrowest set in the file: someone who clicked the icon next
 * to one value wants that value changed, explained, or derived — not a sweep.
 */
const CELL_SCENARIOS: PromptDef[] = [
  {
    key: "cell-rewrite",
    label: {
      en: "Rewrite this value",
      "zh-CN": "改写这一格的值",
      "zh-TW": "改寫這一格的值",
      ja: "この値を書き直す",
    },
    body: {
      en: (t) =>
        `${t}\n\nRead the current value, then rewrite it the way I describe next. Show me the old and the new value side by side before submitting, and don't change the meaning unless I asked you to.`,
      "zh-CN": (t) =>
        `${t}\n\n先读当前的值，然后按我接下来的要求改写它。提交前把旧值和新值并排给我看；除非我明确要求，不要改变原意。`,
      "zh-TW": (t) =>
        `${t}\n\n先讀目前的值，然後按我接下來的要求改寫它。提交前把舊值和新值並排給我看；除非我明確要求，不要改變原意。`,
      ja: (t) =>
        `${t}\n\n現在の値を読んだうえで、次に伝える要件どおりに書き直してください。提出前に旧値と新値を並べて見せ、依頼がない限り意味を変えないでください。`,
    },
  },
  {
    key: "cell-derive",
    label: {
      en: "Fill it in from the other fields",
      "zh-CN": "根据其它字段推出这一格",
      "zh-TW": "根據其他欄位推出這一格",
      ja: "他のフィールドから埋める",
    },
    body: {
      en: (t) =>
        `${t}\n\nWork out what this value should be from the record's OTHER fields. Tell me which fields you used and how you got there. If the record doesn't carry enough information, say so and leave it as it is — do not guess.`,
      "zh-CN": (t) =>
        `${t}\n\n请根据这条记录的其他字段推算这一格应该是什么，并说明你用了哪些字段、怎么推出来的。如果记录里的信息不足以推断，就直说并保持原样——不要猜。`,
      "zh-TW": (t) =>
        `${t}\n\n請根據這筆記錄的其他欄位推算這一格應該是什麼，並說明你用了哪些欄位、怎麼推出來的。如果記錄裡的資訊不足以推斷，就直說並保持原樣——不要猜。`,
      ja: (t) =>
        `${t}\n\nこのレコードの他のフィールドから、この値がどうあるべきかを導いてください。使ったフィールドと導出の筋道を示すこと。情報が足りなければその旨を伝え、値はそのままにしてください——推測は不要です。`,
    },
  },
  {
    key: "cell-explain",
    intent: "read-only",
    label: {
      en: "Explain this value",
      "zh-CN": "解释这一格为什么是这样",
      "zh-TW": "解釋這一格為什麼是這樣",
      ja: "この値の理由を説明",
    },
    body: {
      en: (t) =>
        `${t}\n\nTell me what this value means, when and by whom it last changed, and whether it is consistent with the rest of the record and with the same field on comparable records. Read-only — change nothing.`,
      "zh-CN": (t) =>
        `${t}\n\n请告诉我这个值是什么意思、最近一次是谁在什么时候改的，以及它跟这条记录的其他字段、跟同类记录的这个字段比是否自洽。只读——什么都不要改。`,
      "zh-TW": (t) =>
        `${t}\n\n請告訴我這個值是什麼意思、最近一次是誰在什麼時候改的，以及它跟這筆記錄的其他欄位、跟同類記錄的這個欄位比是否自洽。唯讀——什麼都不要改。`,
      ja: (t) =>
        `${t}\n\nこの値の意味、最後に誰がいつ変更したか、そしてレコード内の他の項目や同種レコードの同じフィールドと整合しているかを教えてください。読み取り専用——何も変更しないでください。`,
    },
  },
];

/** Scenarios for a single RECORD, opened from the record detail view. */
const RECORD_SCENARIOS: PromptDef[] = [
  {
    key: "record-complete",
    label: {
      en: "Complete this record",
      "zh-CN": "补全这条记录",
      "zh-TW": "補全這筆記錄",
      ja: "このレコードを補完",
    },
    body: {
      en: (t) =>
        `${t}\n\nRead every field on this record and the base's field schema. Fill in what's missing or clearly incomplete, using the record's existing content and anything I give you next. Say where each new value came from, and leave anything you'd have to guess at empty.`,
      "zh-CN": (t) =>
        `${t}\n\n请读这条记录的每一个字段以及这张表的字段结构，把缺失或明显没写完的地方补上——依据是这条记录已有的内容，以及我接下来给你的信息。每个新填的值都说明来源；需要靠猜的就留空。`,
      "zh-TW": (t) =>
        `${t}\n\n請讀這筆記錄的每一個欄位以及這張表的欄位結構，把缺失或明顯沒寫完的地方補上——依據是這筆記錄已有的內容，以及我接下來給你的資訊。每個新填的值都說明來源；需要靠猜的就留空。`,
      ja: (t) =>
        `${t}\n\nこのレコードの全フィールドとベースのフィールド構成を読んでください。既存の内容と、私が次に渡す情報をもとに、欠けている・明らかに書きかけの箇所を埋めてください。各値の根拠を示し、推測が必要なものは空のままにしてください。`,
    },
  },
  {
    key: "record-rewrite",
    label: {
      en: "Rewrite this record's content",
      "zh-CN": "改写这条记录的内容",
      "zh-TW": "改寫這筆記錄的內容",
      ja: "このレコードの内容を書き直す",
    },
    body: {
      en: (t) =>
        `${t}\n\nRewrite the text fields on this record the way I describe next — tone, length, or structure. Keep the facts identical; if you think a fact is wrong, say so instead of silently changing it.`,
      "zh-CN": (t) =>
        `${t}\n\n请按我接下来的要求改写这条记录的文本字段——语气、长度或结构。事实内容必须保持不变；如果你觉得某个事实有问题，说出来，不要悄悄改掉。`,
      "zh-TW": (t) =>
        `${t}\n\n請按我接下來的要求改寫這筆記錄的文字欄位——語氣、長度或結構。事實內容必須保持不變；如果你覺得某個事實有問題，說出來，不要悄悄改掉。`,
      ja: (t) =>
        `${t}\n\nこのレコードのテキストフィールドを、次に伝える要件（トーン・長さ・構成）に沿って書き直してください。事実関係は変えないこと。事実がおかしいと思ったら、黙って直さずに指摘してください。`,
    },
  },
  {
    key: "record-explain",
    intent: "read-only",
    label: {
      en: "Explain this record to me",
      "zh-CN": "给我讲讲这条记录",
      "zh-TW": "給我講講這筆記錄",
      ja: "このレコードを説明して",
    },
    body: {
      en: (t) =>
        `${t}\n\nRead this record and its change history, then explain it to me in plain language: what it represents, what changed most recently and why, and anything inconsistent with the rest of the table. Read-only — don't modify it.`,
      "zh-CN": (t) =>
        `${t}\n\n请读这条记录以及它的变更历史，然后用大白话讲给我听：它代表什么、最近改了什么、为什么改，以及有没有和表里其他记录不一致的地方。只读——不要改动它。`,
      "zh-TW": (t) =>
        `${t}\n\n請讀這筆記錄以及它的變更歷史，然後用白話講給我聽：它代表什麼、最近改了什麼、為什麼改，以及有沒有和表裡其他記錄不一致的地方。唯讀——不要改動它。`,
      ja: (t) =>
        `${t}\n\nこのレコードと変更履歴を読み、平易な言葉で説明してください：何を表しているか、直近で何がなぜ変わったか、テーブル内の他のレコードと食い違う点はないか。読み取り専用——変更しないでください。`,
    },
  },
];

// ── Custom scenario prompts (Feature 3) ─────────────────────────────────────────

/** Every locale `PromptDef.label`/`.body` are keyed on — derived from an
 * already-exhaustive `Record<CoreLocale, …>` above instead of a second
 * hardcoded locale list that could drift from it. */
const CORE_LOCALES = Object.keys(TARGET_LINE) as CoreLocale[];

/**
 * Adapt one validated custom prompt (`CustomPromptDef` — iString label/body, a
 * literal `"{target}"` placeholder) into the same `PromptDef` shape the curated
 * `SCENARIOS_BY_TYPE` arrays use, so it flows through the exact `buildCuratedPrompt`
 * assembly below unchanged. `iStringParse` resolves each locale once, with the
 * same fallback behavior already used for Base field names; `{target}` is
 * substituted at render time with the identical target string a curated
 * prompt's `body(target)` receives.
 */
const customPromptDefToPromptDef = (custom: CustomPromptDef): PromptDef => {
  const label = Object.fromEntries(
    CORE_LOCALES.map((locale) => [locale, iStringParse(custom.label, locale)]),
  ) as Record<CoreLocale, string>;
  const body = Object.fromEntries(
    CORE_LOCALES.map((locale) => {
      const template = iStringParse(custom.body, locale);
      return [locale, (target: string) => template.replaceAll("{target}", target)];
    }),
  ) as Record<CoreLocale, (target: string) => string>;
  return { key: custom.key, intent: custom.intent, label, body };
};

/**
 * Read this node's `metadata.agentPrompts` (written by `busabase-cli nodes
 * set-agent-prompts` or a direct API call) and, when present and valid, return
 * it as `PromptDef`s meant to REPLACE `SCENARIOS_BY_TYPE[nodeType]` for the
 * whole-node dialog (§7.3).
 *
 * Returns `undefined` — "fall through to the node type's default scenarios" —
 * when the key is absent, an empty array, or fails `.safeParse`. That last
 * case is the safety net §10's failure matrix requires: corrupt jsonb (a
 * manual edit, or a write that bypassed the CLI's own validation) must never
 * crash the dialog or render garbage, it must render exactly what the node
 * would have shown before this feature existed.
 */
const readCustomAgentPrompts = (
  customPrompts: CustomAgentPrompts | undefined,
): PromptDef[] | undefined => {
  if (!Array.isArray(customPrompts) || customPrompts.length === 0) return undefined;
  // Validated a second time on purpose. The server parses what it stores, but
  // this helper is also reached from tests and from hosts that build a context
  // by hand, and §10's failure matrix wants a bad list to degrade to the type
  // defaults rather than render garbage — wherever it came from.
  const parsed = customAgentPromptsSchema.safeParse(customPrompts);
  if (!parsed.success) return undefined;
  return parsed.data.map(customPromptDefToPromptDef);
};

// ── Assembly ──────────────────────────────────────────────────────────────────

/**
 * Build every prompt available for one node, already localized and interpolated.
 * Returns both tiers; the dialog renders them as consecutive sidebar sections.
 */
/**
 * Render one `PromptDef` into the finished, copy-pasteable prompt.
 *
 * Module-level rather than a closure inside `buildNodeAgentPrompts` because
 * `buildCreateNodePrompts` needs exactly the same rendering — same target-line
 * injection, same approval/reply footer — for prompts whose target is a place
 * to create in rather than a node to act on.
 */
const buildCuratedPrompt = (
  prompt: PromptDef,
  locale: CoreLocale,
  target: string,
  tier: PromptTier,
  group: string,
): NodePrompt => {
  const intent = prompt.intent ?? "change";
  const footer =
    intent === "read-only"
      ? REPLY_LANGUAGE[locale]
      : `${APPROVAL_POLICY[locale]} ${REPLY_LANGUAGE[locale]}`;

  return {
    key: prompt.key,
    tier,
    label: prompt.label[locale],
    group,
    body: `${prompt.body[locale](target)}\n\n${footer}`,
  };
};

export function buildNodeAgentPrompts(
  context: NodePromptContext,
  locale: CoreLocale,
  messages: CoreI18nMessages,
): { scenarios: NodePrompt[]; capabilities: NodePrompt[] } {
  const definition = getNodeType(context.nodeType);
  const typeLabel = definition?.label ?? context.nodeType;
  const scope = context.scope ?? { kind: "node" };
  const target = TARGET_LINE[locale](context, typeLabel) + scopeLine(locale, scope);
  const groupLabels = GROUP_LABELS[locale];

  const SCENARIOS_BY_SCOPE: Partial<Record<NodePromptScope["kind"], PromptDef[]>> = {
    field: FIELD_SCENARIOS,
    record: RECORD_SCENARIOS,
    cell: CELL_SCENARIOS,
  };
  // Custom scenario prompts (§7.3) are authored per NODE and only ever replace
  // the whole-node dialog's scenario tier — a field/record/cell-scoped dialog
  // always uses its own narrower, scope-specific set above, same as before this
  // feature existed. A node's custom prompts have no opinion about "just this
  // column" or "just this record".
  const scenarioDefs =
    scope.kind === "node"
      ? (readCustomAgentPrompts(context.customPrompts) ?? SCENARIOS_BY_TYPE[context.nodeType] ?? [])
      : (SCENARIOS_BY_SCOPE[scope.kind] ?? SCENARIOS_BY_TYPE[context.nodeType] ?? []);

  const scenarios = scenarioDefs.map((scenario) =>
    buildCuratedPrompt(scenario, locale, target, "scenario", groupLabels.content),
  );

  // Type-specific operations first, then the generic node_* tree ops every type has.
  // A narrowed dialog drops the node-tree operations entirely (moving or renaming
  // the whole Base is not a thing you do "to this column") and keeps only what can
  // actually act on the scoped target:
  //   field  → the column itself, plus the record ops that write values into it
  //   record → the record ops
  //   cell   → updating a value is the ONLY operation that fits; creating or
  //            deleting a record is a different scope wearing the same word.
  const scopeAllows: Partial<Record<NodePromptScope["kind"], (kind: string) => boolean>> = {
    field: (kind) => groupOf(kind) === "field" || groupOf(kind) === "record",
    record: (kind) => groupOf(kind) === "record",
    cell: (kind) => kind === "record_update",
  };
  const allows = scopeAllows[scope.kind];
  const kinds = [
    ...(definition?.operations ?? []).map((operation) => operation.kind),
    ...(allows ? [] : GENERIC_NODE_OPERATION_KINDS),
  ].filter((kind) => !allows || allows(kind));

  const curatedContentPrompts =
    scope.kind === "node" ? (CONTENT_PROMPTS_BY_TYPE[context.nodeType] ?? []) : [];
  const capabilities: NodePrompt[] = [
    ...curatedContentPrompts.map((prompt) =>
      buildCuratedPrompt(prompt, locale, target, "capability", groupLabels.content),
    ),
    ...kinds.map((kind): NodePrompt => {
      const labelKey = operationLabelKeys[kind as keyof typeof operationLabelKeys];
      // A plugin type's operation may not have an i18n entry yet — fall back to the
      // registry's own English label rather than rendering an empty row.
      const opLabel =
        (labelKey ? messages.operation[labelKey] : undefined) ??
        definition?.operations.find((operation) => operation.kind === kind)?.label ??
        kind;
      const group = groupOf(kind);
      return {
        key: kind,
        tier: "capability",
        label: opLabel,
        group: groupLabels[group],
        body: `${CAPABILITY_TEMPLATE[locale](target, opLabel)}\n\n${APPROVAL_POLICY[locale]} ${
          REPLY_LANGUAGE[locale]
        }`,
      };
    }),
  ];

  // Stable, readable ordering: group by bucket in GROUP_ORDER, preserving each
  // bucket's registry order inside it.
  const rank = new Map(GROUP_ORDER.map((key, index) => [groupLabels[key], index]));
  capabilities.sort(
    (a, b) => (rank.get(a.group) ?? GROUP_ORDER.length) - (rank.get(b.group) ?? GROUP_ORDER.length),
  );

  return { scenarios, capabilities };
}

// ── Create prompts ────────────────────────────────────────────────────────────
//
// The other half of the New-item modal: instead of filling the form yourself,
// copy a prompt (or hand it straight to an agent) and let the agent create the
// thing. Deliberately built on the same `PromptDef` machinery as the per-node
// prompts — the only thing that differs is the target line, which names a place
// to create *in* rather than a node to act *on*. Everything downstream (the
// approval footer, the reply-language footer, `AgentPromptsView`) is shared.

/** Where the new item should go. No node exists yet, so there is no `nodeId`. */
export interface CreateNodePromptContext {
  spaceId?: string;
  spaceName?: string;
  /** The folder the "+" was clicked on. Absent when creating at the root. */
  parentNodeId?: string;
  parentName?: string;
}

const CREATE_TARGET_LINE: Record<CoreLocale, (c: CreateNodePromptContext) => string> = {
  en: (c) => {
    const where = c.parentNodeId
      ? `inside the folder "${c.parentName ?? c.parentNodeId}" (nodeId: ${c.parentNodeId})`
      : "at the root";
    const space = c.spaceId
      ? ` of the space "${c.spaceName ?? c.spaceId}" (spaceId: ${c.spaceId})`
      : "";
    return `Target: create something new in Busabase, ${where}${space}.`;
  },
  "zh-CN": (c) => {
    const where = c.parentNodeId
      ? `文件夹「${c.parentName ?? c.parentNodeId}」（nodeId: ${c.parentNodeId}）里`
      : "根目录下";
    const space = c.spaceId ? `空间「${c.spaceName ?? c.spaceId}」（spaceId: ${c.spaceId}）的` : "";
    return `目标：在 Busabase ${space}${where}新建内容。`;
  },
  "zh-TW": (c) => {
    const where = c.parentNodeId
      ? `資料夾「${c.parentName ?? c.parentNodeId}」（nodeId: ${c.parentNodeId}）裡`
      : "根目錄下";
    const space = c.spaceId ? `空間「${c.spaceName ?? c.spaceId}」（spaceId: ${c.spaceId}）的` : "";
    return `目標：在 Busabase ${space}${where}新建內容。`;
  },
  ja: (c) => {
    const where = c.parentNodeId
      ? `フォルダ「${c.parentName ?? c.parentNodeId}」（nodeId: ${c.parentNodeId}）の中`
      : "ルート直下";
    const space = c.spaceId
      ? `スペース「${c.spaceName ?? c.spaceId}」（spaceId: ${c.spaceId}）の`
      : "";
    return `対象：Busabase の${space}${where}に新しく作成します。`;
  },
};

const CREATE_GROUP_LABEL: Record<CoreLocale, string> = {
  en: "Create",
  "zh-CN": "新建",
  "zh-TW": "新建",
  ja: "作成",
};

/**
 * The row label for one creatable type. Carries the verb, matching how the
 * per-node capability tier reads ("Create record", not "Record") — the type
 * name alone next to a "Create" heading reads as a filter, not an action.
 */
const CREATE_ITEM_LABEL: Record<CoreLocale, (typeLabel: string) => string> = {
  en: (typeLabel) => `Create ${typeLabel}`,
  "zh-CN": (typeLabel) => `新建 ${typeLabel}`,
  "zh-TW": (typeLabel) => `新建 ${typeLabel}`,
  ja: (typeLabel) => `${typeLabel} を作成`,
};

/**
 * Curated, cross-type scenarios — deliberately NOT filtered by whatever type is
 * selected in the form tab. Someone who came here came because they do not yet
 * know what to create; filtering would hide exactly the prompts that span types
 * ("build me a folder structure"), which is the reason to ask an agent at all.
 */
const CREATE_SCENARIOS: PromptDef[] = [
  {
    key: "create-base-for",
    label: {
      en: "A Base to track something",
      "zh-CN": "建个表来跟踪某件事",
      "zh-TW": "建個表來追蹤某件事",
      ja: "何かを管理する Base を作る",
    },
    body: {
      en: (t) =>
        `${t}\n\nI want a Base to track something — I'll describe it next. Propose the field schema first (field names, types, and why each one), and create it only after I approve the proposal.`,
      "zh-CN": (t) =>
        `${t}\n\n我想要一个表来跟踪某件事——我接下来描述。请先给我字段方案（字段名、类型、每个字段的理由），我确认后再创建。`,
      "zh-TW": (t) =>
        `${t}\n\n我想要一個表來追蹤某件事——我接下來描述。請先給我欄位方案（欄位名、型別、每個欄位的理由），我確認後再建立。`,
      ja: (t) =>
        `${t}\n\n何かを管理するための Base が欲しいです（内容はこの後説明します）。まずフィールド構成（名前・型・各フィールドの理由）を提案し、私が承認してから作成してください。`,
    },
  },
  {
    key: "create-base-from-data",
    label: {
      en: "Turn this data into a Base",
      "zh-CN": "把这份数据建成一个表",
      "zh-TW": "把這份資料建成一個表",
      ja: "このデータを Base にする",
    },
    body: {
      en: (t) =>
        `${t}\n\nI'll paste a table (CSV, spreadsheet, or a list). Infer a field schema from it, show me the schema and how many rows you read, then create the Base and import the rows.`,
      "zh-CN": (t) =>
        `${t}\n\n我会粘贴一份表格数据（CSV、电子表格或列表）。请据此推断字段结构，先告诉我字段方案和你读到的行数，然后再创建这个表并导入数据。`,
      "zh-TW": (t) =>
        `${t}\n\n我會貼上一份表格資料（CSV、試算表或清單）。請據此推斷欄位結構，先告訴我欄位方案和你讀到的列數，然後再建立這個表並匯入資料。`,
      ja: (t) =>
        `${t}\n\n表データ（CSV・スプレッドシート・リスト）を貼り付けます。そこからフィールド構成を推測し、構成と読み取った行数を先に提示してから、Base を作成してデータを取り込んでください。`,
    },
  },
  {
    key: "create-doc-draft",
    label: {
      en: "A Doc, and draft it for me",
      "zh-CN": "建文档并帮我起草",
      "zh-TW": "建文件並幫我起草",
      ja: "Doc を作って下書きする",
    },
    body: {
      en: (t) =>
        `${t}\n\nCreate a Doc and draft its first version from what I describe next. Give me an outline before you write the full draft.`,
      "zh-CN": (t) =>
        `${t}\n\n请创建一篇文档，并根据我接下来的描述起草第一版。写全文之前先给我一个大纲。`,
      "zh-TW": (t) =>
        `${t}\n\n請建立一篇文件，並根據我接下來的描述起草第一版。寫全文之前先給我一個大綱。`,
      ja: (t) =>
        `${t}\n\nDoc を作成し、この後の説明にもとづいて初稿を書いてください。全文を書く前にアウトラインを見せてください。`,
    },
  },
  {
    key: "create-folder-structure",
    label: {
      en: "A whole folder structure",
      "zh-CN": "建一套文件夹结构",
      "zh-TW": "建一套資料夾結構",
      ja: "フォルダ構成をまとめて作る",
    },
    body: {
      en: (t) =>
        `${t}\n\nI'll describe how I want this area organized. Propose the whole tree — folders, and what goes in each — as a plan I can read in one go, then create it once I approve.`,
      "zh-CN": (t) =>
        `${t}\n\n我会描述这块内容想怎么组织。请把整棵树——有哪些文件夹、每个里面放什么——作为一份我能一眼看完的方案给我，我确认后再创建。`,
      "zh-TW": (t) =>
        `${t}\n\n我會描述這塊內容想怎麼組織。請把整棵樹——有哪些資料夾、每個裡面放什麼——作為一份我能一眼看完的方案給我，我確認後再建立。`,
      ja: (t) =>
        `${t}\n\nこの領域をどう整理したいかを説明します。フォルダ構成と各フォルダの中身を、一度に読める計画としてまとめて提案し、承認後に作成してください。`,
    },
  },
  {
    key: "create-from-template",
    label: {
      en: "Set one up from a template",
      "zh-CN": "照模板装一套",
      "zh-TW": "照範本裝一套",
      ja: "テンプレートから用意する",
    },
    body: {
      en: (t) =>
        `${t}\n\nLook at what's available in the template center, recommend the one that fits what I describe next, and tell me what it will create before installing it.`,
      "zh-CN": (t) =>
        `${t}\n\n请看看模板中心里有什么，根据我接下来的描述推荐最合适的一个，并在安装前告诉我它会创建哪些东西。`,
      "zh-TW": (t) =>
        `${t}\n\n請看看範本中心裡有什麼，根據我接下來的描述推薦最合適的一個，並在安裝前告訴我它會建立哪些東西。`,
      ja: (t) =>
        `${t}\n\nテンプレートセンターにあるものを確認し、この後の説明に合うものを推薦してください。インストールする前に、何が作成されるかを教えてください。`,
    },
  },
];

const CREATE_CAPABILITY_TEMPLATE: Record<
  CoreLocale,
  (target: string, typeLabel: string, nodeType: string) => string
> = {
  en: (target, typeLabel, nodeType) =>
    `${target}\n\nCreate a new ${typeLabel} (node type: "${nodeType}") here.\nAsk me for its name and anything else you need before creating it.`,
  "zh-CN": (target, typeLabel, nodeType) =>
    `${target}\n\n请在这里创建一个新的 ${typeLabel}（节点类型：「${nodeType}」）。\n创建前先问我它的名字，以及你还需要的其他信息。`,
  "zh-TW": (target, typeLabel, nodeType) =>
    `${target}\n\n請在這裡建立一個新的 ${typeLabel}（節點類型：「${nodeType}」）。\n建立前先問我它的名字，以及你還需要的其他資訊。`,
  ja: (target, typeLabel, nodeType) =>
    `${target}\n\nここに新しい ${typeLabel}（ノードタイプ：「${nodeType}」）を作成してください。\n作成する前に、名前と必要な情報を私に確認してください。`,
};

/**
 * Prompts for creating something, sibling to `buildNodeAgentPrompts`.
 *
 * A separate entry point rather than a `scope` of the node builder: that one
 * requires `nodeType`/`nodeId`/`nodeName`, none of which exist before the thing
 * is created, and making them optional would weaken the type for every existing
 * caller to serve this one.
 *
 * The capability tier is derived from the same registry filter the form tab's
 * type grid uses, so a newly registered creatable type appears in both at once.
 */
export function buildCreateNodePrompts(
  context: CreateNodePromptContext,
  locale: CoreLocale,
): { scenarios: NodePrompt[]; capabilities: NodePrompt[] } {
  const target = CREATE_TARGET_LINE[locale](context);
  const groupLabels = GROUP_LABELS[locale];

  const scenarios = CREATE_SCENARIOS.map((scenario) =>
    buildCuratedPrompt(scenario, locale, target, "scenario", groupLabels.content),
  );

  const capabilities = listNodeTypes()
    .filter((definition) => definition.capabilities.creatable && !definition.capabilities.hidden)
    .map((definition): NodePrompt => {
      const typeLabel = definition.label;
      return {
        key: `create-${definition.type}`,
        tier: "capability",
        label: CREATE_ITEM_LABEL[locale](typeLabel),
        group: CREATE_GROUP_LABEL[locale],
        body: `${CREATE_CAPABILITY_TEMPLATE[locale](target, typeLabel, definition.type)}\n\n${
          APPROVAL_POLICY[locale]
        } ${REPLY_LANGUAGE[locale]}`,
      };
    });

  return { scenarios, capabilities };
}
