/**
 * Copy-pasteable Agent prompts, scoped to one node.
 *
 * Two deliberately different tiers (see `PromptTier`):
 *
 * - **capability** — machine-shaped and *exhaustive*: one entry per operation the
 *   node type registers, derived straight from the node-type registry. The body is
 *   a single per-locale template filled with the already-translated operation label
 *   (`messages.operation.*`), so a new node type — including a build-time plugin
 *   one — gets a complete, translated prompt set for free, and the list can never
 *   drift from what the system can actually do.
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

import { GENERIC_NODE_OPERATION_KINDS, getNodeType } from "busabase-contract/domains";
import type { CoreLocale } from "../../../i18n";
import type { CoreI18nMessages } from "../../../i18n/messages";
import { operationLabelKeys } from "./change-request";

export type PromptTier = "scenario" | "capability";

export interface NodePromptContext {
  nodeType: string;
  nodeName: string;
  nodeId: string;
  spaceName?: string;
  spaceId?: string;
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

/**
 * The approval rule + reply language, appended to every prompt. Busabase is
 * approval-first: an agent must never merge on its own, so this is repeated on
 * each prompt rather than assumed — a pasted prompt is often the only context
 * the agent gets.
 */
const FOOTER: Record<CoreLocale, string> = {
  en: "Submit the change as a ChangeRequest and never merge it without my approval. Reply to me in English.",
  "zh-CN": "以 ChangeRequest 提交改动，未经我批准绝不要合并。请用简体中文回复我。",
  "zh-TW": "以 ChangeRequest 提交變更，未經我核准絕不要合併。請用繁體中文回覆我。",
  ja: "変更は ChangeRequest として提出し、私の承認なしに絶対にマージしないでください。日本語で返信してください。",
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
 * `body` receives the already-built target line so every scenario stays
 * consistent about how it names the node.
 */
interface ScenarioDef {
  key: string;
  label: Record<CoreLocale, string>;
  body: Record<CoreLocale, (target: string) => string>;
}

const BASE_SCENARIOS: ScenarioDef[] = [
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

const DOC_SCENARIOS: ScenarioDef[] = [
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

const DRIVE_SCENARIOS: ScenarioDef[] = [
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

const SKILL_SCENARIOS: ScenarioDef[] = [
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

const AIRAPP_SCENARIOS: ScenarioDef[] = [
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

const SCENARIOS_BY_TYPE: Record<string, ScenarioDef[]> = {
  base: BASE_SCENARIOS,
  doc: DOC_SCENARIOS,
  drive: DRIVE_SCENARIOS,
  skill: SKILL_SCENARIOS,
  airapp: AIRAPP_SCENARIOS,
};

// ── Assembly ──────────────────────────────────────────────────────────────────

/**
 * Build every prompt available for one node, already localized and interpolated.
 * Returns both tiers; the dialog renders them as consecutive sidebar sections.
 */
export function buildNodeAgentPrompts(
  context: NodePromptContext,
  locale: CoreLocale,
  messages: CoreI18nMessages,
): { scenarios: NodePrompt[]; capabilities: NodePrompt[] } {
  const definition = getNodeType(context.nodeType);
  const typeLabel = definition?.label ?? context.nodeType;
  const target = TARGET_LINE[locale](context, typeLabel);
  const footer = FOOTER[locale];
  const groupLabels = GROUP_LABELS[locale];

  const scenarios: NodePrompt[] = (SCENARIOS_BY_TYPE[context.nodeType] ?? []).map((scenario) => ({
    key: scenario.key,
    tier: "scenario",
    label: scenario.label[locale],
    group: groupLabels.content,
    body: `${scenario.body[locale](target)}\n\n${footer}`,
  }));

  // Type-specific operations first, then the generic node_* tree ops every type has.
  const kinds = [
    ...(definition?.operations ?? []).map((operation) => operation.kind),
    ...GENERIC_NODE_OPERATION_KINDS,
  ];

  const capabilities: NodePrompt[] = kinds.map((kind) => {
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
      body: `${CAPABILITY_TEMPLATE[locale](target, opLabel)}\n\n${footer}`,
    };
  });

  // Stable, readable ordering: group by bucket in GROUP_ORDER, preserving each
  // bucket's registry order inside it.
  const rank = new Map(GROUP_ORDER.map((key, index) => [groupLabels[key], index]));
  capabilities.sort(
    (a, b) => (rank.get(a.group) ?? GROUP_ORDER.length) - (rank.get(b.group) ?? GROUP_ORDER.length),
  );

  return { scenarios, capabilities };
}
