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
export type NodePromptSource = "built-in-scenario" | "custom-scenario" | "capability";

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
   * caller (`nodes.getAgentPrompts`). They are appended after the node type's
   * built-in scenarios so product updates never erase the familiar defaults.
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
  source: NodePromptSource;
  /** Original persisted key. Present only for a custom scenario. */
  customKey?: string;
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
  ko: (c, typeLabel) =>
    `대상: Busabase ${typeLabel} "${c.nodeName}" (nodeId: ${c.nodeId})` +
    (c.spaceId ? `, 스페이스 "${c.spaceName ?? c.spaceId}" (spaceId: ${c.spaceId}) 소속` : "") +
    ".",
  es: (c, typeLabel) =>
    `Destino: ${typeLabel} de Busabase «${c.nodeName}» (nodeId: ${c.nodeId})` +
    (c.spaceId ? `, en el espacio «${c.spaceName ?? c.spaceId}» (spaceId: ${c.spaceId})` : "") +
    ".",
  pt: (c, typeLabel) =>
    `Alvo: ${typeLabel} do Busabase “${c.nodeName}” (nodeId: ${c.nodeId})` +
    (c.spaceId ? `, no espaço “${c.spaceName ?? c.spaceId}” (spaceId: ${c.spaceId})` : "") +
    ".",
  vi: (c, typeLabel) =>
    `Đối tượng: ${typeLabel} “${c.nodeName}” của Busabase (nodeId: ${c.nodeId})` +
    (c.spaceId ? `, trong không gian “${c.spaceName ?? c.spaceId}” (spaceId: ${c.spaceId})` : "") +
    ".",
  fr: (c, typeLabel) =>
    `Cible : ${typeLabel} Busabase « ${c.nodeName} » (nodeId: ${c.nodeId})` +
    (c.spaceId ? `, dans l'espace « ${c.spaceName ?? c.spaceId} » (spaceId: ${c.spaceId})` : "") +
    ".",
  de: (c, typeLabel) =>
    `Ziel: ${typeLabel} „${c.nodeName}“ in Busabase (nodeId: ${c.nodeId})` +
    (c.spaceId ? `, im Space „${c.spaceName ?? c.spaceId}“ (spaceId: ${c.spaceId})` : "") +
    ".",
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
  ko: {
    field: (s) =>
      ` 필드 하나만 다뤄 주세요: "${s.fieldName}" (fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `, 유형: ${s.fieldType}` : ""
      }). 다른 필드는 건드리지 마세요.`,
    record: (s) =>
      ` 레코드 하나만 다뤄 주세요: ${s.recordTitle ? `"${s.recordTitle}" ` : ""}(recordId: ${
        s.recordId
      }). 다른 레코드는 건드리지 마세요.`,
    cell: (s) =>
      ` 값 하나만 다뤄 주세요: 레코드 ${s.recordTitle ? `"${s.recordTitle}" ` : ""}(recordId: ${
        s.recordId
      })의 "${s.fieldName}" 필드 (fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `, 유형: ${s.fieldType}` : ""
      }). 이 레코드의 다른 필드도, 다른 레코드의 이 필드도 건드리지 마세요.`,
  },
  es: {
    field: (s) =>
      ` Trabaja con UN solo campo: «${s.fieldName}» (fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `, tipo: ${s.fieldType}` : ""
      }). No toques ningún otro campo.`,
    record: (s) =>
      ` Trabaja con UN solo registro: ${s.recordTitle ? `«${s.recordTitle}» ` : ""}(recordId: ${
        s.recordId
      }). No toques ningún otro registro.`,
    cell: (s) =>
      ` Trabaja con UN solo valor: el campo «${s.fieldName}» (fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `, tipo: ${s.fieldType}` : ""
      }) del registro ${s.recordTitle ? `«${s.recordTitle}» ` : ""}(recordId: ${
        s.recordId
      }). No toques ningún otro campo de este registro ni este campo en ningún otro registro.`,
  },
  pt: {
    field: (s) =>
      ` Trabalhe em UM único campo: “${s.fieldName}” (fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `, tipo: ${s.fieldType}` : ""
      }). Não mexa em nenhum outro campo.`,
    record: (s) =>
      ` Trabalhe em UM único registro: ${s.recordTitle ? `“${s.recordTitle}” ` : ""}(recordId: ${
        s.recordId
      }). Não mexa em nenhum outro registro.`,
    cell: (s) =>
      ` Trabalhe em UM único valor: o campo “${s.fieldName}” (fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `, tipo: ${s.fieldType}` : ""
      }) do registro ${s.recordTitle ? `“${s.recordTitle}” ` : ""}(recordId: ${
        s.recordId
      }). Não mexa em nenhum outro campo deste registro nem neste campo em nenhum outro registro.`,
  },
  vi: {
    field: (s) =>
      ` Chỉ làm việc với MỘT trường: “${s.fieldName}” (fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `, kiểu: ${s.fieldType}` : ""
      }). Đừng động vào bất kỳ trường nào khác.`,
    record: (s) =>
      ` Chỉ làm việc với MỘT bản ghi: ${s.recordTitle ? `“${s.recordTitle}” ` : ""}(recordId: ${
        s.recordId
      }). Đừng động vào bất kỳ bản ghi nào khác.`,
    cell: (s) =>
      ` Chỉ làm việc với MỘT giá trị: trường “${s.fieldName}” (fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `, kiểu: ${s.fieldType}` : ""
      }) của bản ghi ${s.recordTitle ? `“${s.recordTitle}” ` : ""}(recordId: ${
        s.recordId
      }). Đừng động vào trường khác của bản ghi này, và cũng đừng động vào trường này ở bất kỳ bản ghi nào khác.`,
  },
  fr: {
    field: (s) =>
      ` Travaillez sur UN seul champ : « ${s.fieldName} » (fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `, type : ${s.fieldType}` : ""
      }). Ne touchez à aucun autre champ.`,
    record: (s) =>
      ` Travaillez sur UN seul enregistrement : ${s.recordTitle ? `« ${s.recordTitle} » ` : ""}(recordId: ${
        s.recordId
      }). Ne touchez à aucun autre enregistrement.`,
    cell: (s) =>
      ` Travaillez sur UNE seule valeur : le champ « ${s.fieldName} » (fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `, type : ${s.fieldType}` : ""
      }) de l'enregistrement ${s.recordTitle ? `« ${s.recordTitle} » ` : ""}(recordId: ${
        s.recordId
      }). Ne touchez à aucun autre champ de cet enregistrement, ni à ce champ dans un autre enregistrement.`,
  },
  de: {
    field: (s) =>
      ` Arbeiten Sie nur an EINEM Feld: „${s.fieldName}“ (fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `, Typ: ${s.fieldType}` : ""
      }). Lassen Sie alle anderen Felder unangetastet.`,
    record: (s) =>
      ` Arbeiten Sie nur an EINEM Datensatz: ${s.recordTitle ? `„${s.recordTitle}“ ` : ""}(recordId: ${
        s.recordId
      }). Lassen Sie alle anderen Datensätze unangetastet.`,
    cell: (s) =>
      ` Arbeiten Sie nur an EINEM Wert: dem Feld „${s.fieldName}“ (fieldSlug: ${s.fieldSlug}${
        s.fieldType ? `, Typ: ${s.fieldType}` : ""
      }) des Datensatzes ${s.recordTitle ? `„${s.recordTitle}“ ` : ""}(recordId: ${
        s.recordId
      }). Fassen Sie kein anderes Feld dieses Datensatzes an und dieses Feld in keinem anderen Datensatz.`,
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
 * Mutating prompts tell the agent not to pick a merge policy at all.
 *
 * This used to read "never merge it without my approval", which was written
 * when Busabase was positioned as approval-first. It no longer is: every write
 * is permission-aware (`shouldAutoMerge`, and see `contract/auto-merge.ts`) —
 * omitting `autoMerge` means "merge now if this actor has write access on the
 * target, otherwise queue for review", and the server decides. A blanket "never
 * merge" instruction pushed agents toward an explicit `autoMerge: false`, which
 * forces a review queue on someone who has write access and is exactly the
 * friction the permission-aware default removed — a person archiving one
 * duplicate record in their own workspace should not have to go approve it.
 *
 * So the instruction names the two things an agent must NOT decide on its own
 * (force a merge, force a review) and leaves the decision where it belongs. The
 * "don't approve what is already waiting" half is still real: with a
 * proposal-only key the change does queue, and approving it is the human's.
 *
 * Reply-language guidance stays separate because read-only prompts need it
 * without accidentally asking the agent to create a change.
 */
const MERGE_POLICY: Record<CoreLocale, string> = {
  en: "Submit the change and let Busabase apply my permissions — don't choose a merge policy yourself unless I ask for one, and don't approve a request that is already waiting on me.",
  "zh-CN":
    "提交改动，让 Busabase 按我的权限来处理——除非我明确要求，否则不要自己指定合并策略，也不要去批准已经在等我处理的请求。",
  "zh-TW":
    "提交變更，讓 Busabase 依我的權限處理——除非我明確要求，否則不要自己指定合併策略，也不要去核准已經在等我處理的請求。",
  ja: "変更を提出し、マージするかどうかは私の権限に基づいて Busabase に任せてください。私が明示的に指示しない限り、マージ方針を自分で指定せず、すでに私の判断を待っているリクエストを承認しないでください。",
  ko: "변경 사항을 제출하고, 병합 여부는 제 권한에 따라 Busabase가 처리하도록 맡겨 주세요. 제가 요청하지 않는 한 병합 정책을 직접 정하지 말고, 이미 제 확인을 기다리는 요청을 승인하지도 마세요.",
  es: "Envía el cambio y deja que Busabase aplique mis permisos: no elijas tú una política de fusión salvo que yo te la pida, y no apruebes una solicitud que ya esté esperando mi decisión.",
  pt: "Envie a alteração e deixe o Busabase aplicar as minhas permissões — não escolha você mesmo uma política de mesclagem, a menos que eu peça, e não aprove uma solicitação que já esteja aguardando a minha decisão.",
  vi: "Hãy gửi thay đổi và để Busabase áp dụng quyền của tôi — đừng tự chọn chính sách hợp nhất trừ khi tôi yêu cầu, và đừng phê duyệt yêu cầu đang chờ tôi xử lý.",
  fr: "Soumettez la modification et laissez Busabase appliquer mes autorisations — ne choisissez pas vous-même de règle de fusion sauf si je vous le demande, et n'approuvez pas une demande qui attend déjà ma décision.",
  de: "Reichen Sie die Änderung ein und lassen Sie Busabase meine Berechtigungen anwenden – wählen Sie nicht selbst eine Merge-Richtlinie, es sei denn, ich verlange es, und genehmigen Sie keine Anfrage, die bereits auf meine Entscheidung wartet.",
};

const REPLY_LANGUAGE: Record<CoreLocale, string> = {
  en: "Reply to me in English.",
  "zh-CN": "请用简体中文回复我。",
  "zh-TW": "請用繁體中文回覆我。",
  ja: "日本語で返信してください。",
  ko: "한국어로 답변해 주세요.",
  es: "Responde en español.",
  pt: "Responda em português.",
  vi: "Hãy trả lời tôi bằng tiếng Việt.",
  fr: "Répondez-moi en français.",
  de: "Antworten Sie mir auf Deutsch.",
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
  ko: (target, opLabel) =>
    `${target}\n\n다음 작업을 수행해 주세요: ${opLabel}.\n먼저 노드의 현재 상태를 확인하고, 더 필요한 정보가 있으면 저에게 물어봐 주세요.`,
  es: (target, opLabel) =>
    `${target}\n\nRealiza esta operación: ${opLabel}.\nPrimero revisa el estado actual del nodo y luego pídeme cualquier dato que aún te falte.`,
  pt: (target, opLabel) =>
    `${target}\n\nExecute esta operação: ${opLabel}.\nPrimeiro verifique o estado atual do nó e depois me peça qualquer informação que ainda faltar.`,
  vi: (target, opLabel) =>
    `${target}\n\nHãy thực hiện thao tác này: ${opLabel}.\nTrước tiên hãy xem trạng thái hiện tại của nút, rồi hỏi tôi bất cứ thông tin nào bạn còn thiếu.`,
  fr: (target, opLabel) =>
    `${target}\n\nEffectuez cette opération : ${opLabel}.\nExaminez d'abord l'état actuel du nœud, puis demandez-moi tout ce qu'il vous manque encore.`,
  de: (target, opLabel) =>
    `${target}\n\nFühren Sie diese Operation aus: ${opLabel}.\nPrüfen Sie zuerst den aktuellen Zustand des Knotens und fragen Sie mich dann nach allem, was Ihnen noch fehlt.`,
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
  ko: {
    record: "레코드",
    field: "필드",
    view: "뷰",
    content: "콘텐츠",
    node: "일반",
    other: "기타",
  },
  es: {
    record: "Registros",
    field: "Campos",
    view: "Vistas",
    content: "Contenido",
    node: "General",
    other: "Otros",
  },
  pt: {
    record: "Registros",
    field: "Campos",
    view: "Visualizações",
    content: "Conteúdo",
    node: "Geral",
    other: "Outros",
  },
  vi: {
    record: "Bản ghi",
    field: "Trường",
    view: "Chế độ xem",
    content: "Nội dung",
    node: "Chung",
    other: "Khác",
  },
  fr: {
    record: "Enregistrements",
    field: "Champs",
    view: "Vues",
    content: "Contenu",
    node: "Général",
    other: "Autres",
  },
  de: {
    record: "Datensätze",
    field: "Felder",
    view: "Ansichten",
    content: "Inhalt",
    node: "Allgemein",
    other: "Sonstiges",
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
    key: "base-find",
    intent: "read-only",
    label: {
      en: "Find the records I mean",
      "zh-CN": "帮我找出符合条件的记录",
      "zh-TW": "幫我找出符合條件的記錄",
      ja: "条件に合うレコードを探す",
      ko: "조건에 맞는 레코드 찾기",
      es: "Encontrar los registros que busco",
      pt: "Encontrar os registros que quero",
      vi: "Tìm các bản ghi tôi cần",
      fr: "Trouver les enregistrements que je veux",
      de: "Die gewünschten Datensätze finden",
    },
    body: {
      en: (t) =>
        `${t}\n\nI'll describe which records I want in plain language. Read the field schema first so you filter on the right fields, then show me the matching records and say how you filtered — I need to be able to tell a wrong filter from an empty result. Read-only; don't change anything.`,
      "zh-CN": (t) =>
        `${t}\n\n我会用大白话描述我想要哪些记录。请先读字段结构，确保你筛的是对的字段，然后把符合的记录列给我，并说明你是按什么条件筛的——我需要能分清"筛错了"和"确实没有"。只读，不要改动任何数据。`,
      "zh-TW": (t) =>
        `${t}\n\n我會用白話描述我想要哪些記錄。請先讀欄位結構，確保你篩的是對的欄位，然後把符合的記錄列給我，並說明你是按什麼條件篩的——我需要能分清「篩錯了」和「確實沒有」。唯讀，不要改動任何資料。`,
      ja: (t) =>
        `${t}\n\n欲しいレコードを普通の言葉で説明します。まずフィールド構成を読んで正しいフィールドで絞り込み、該当レコードを見せたうえで、どう絞り込んだかも教えてください——「条件を間違えた」のか「本当に無い」のかを私が区別できる必要があります。読み取り専用、データは変更しないでください。`,
      ko: (t) =>
        `${t}\n\n저는 원하는 레코드를 평소 말투로 설명할 거예요. 먼저 필드 구성을 읽어서 올바른 필드로 필터링한 다음, 조건에 맞는 레코드를 보여 주고 어떻게 필터링했는지도 알려 주세요. 필터를 잘못 건 것인지 정말 결과가 없는 것인지 제가 구분할 수 있어야 합니다. 읽기 전용이므로 아무것도 변경하지 마세요.`,
      es: (t) =>
        `${t}\n\nTe describiré con palabras normales qué registros quiero. Lee primero el esquema de campos para filtrar por los campos correctos, luego muéstrame los registros que coinciden y dime cómo filtraste: necesito poder distinguir un filtro equivocado de un resultado realmente vacío. Solo lectura; no cambies nada.`,
      pt: (t) =>
        `${t}\n\nVou descrever com palavras simples quais registros eu quero. Leia primeiro o esquema de campos para filtrar pelos campos certos, depois mostre os registros que correspondem e diga como você filtrou — preciso conseguir distinguir um filtro errado de um resultado realmente vazio. Somente leitura; não altere nada.`,
      vi: (t) =>
        `${t}\n\nTôi sẽ mô tả bằng lời thường những bản ghi tôi muốn. Trước tiên hãy đọc cấu trúc trường để lọc đúng trường, sau đó cho tôi xem các bản ghi khớp và cho biết bạn đã lọc như thế nào — tôi cần phân biệt được bộ lọc sai với kết quả thật sự trống. Chỉ đọc; đừng thay đổi gì.`,
      fr: (t) =>
        `${t}\n\nJe vais décrire en langage courant les enregistrements que je veux. Lisez d'abord le schéma des champs pour filtrer sur les bons champs, puis montrez-moi les enregistrements correspondants et dites-moi comment vous avez filtré — je dois pouvoir distinguer un mauvais filtre d'un résultat réellement vide. Lecture seule ; ne modifiez rien.`,
      de: (t) =>
        `${t}\n\nIch beschreibe in normalen Worten, welche Datensätze ich meine. Lesen Sie zuerst das Feldschema, damit Sie nach den richtigen Feldern filtern, zeigen Sie mir dann die passenden Datensätze und sagen Sie, wie Sie gefiltert haben – ich muss einen falschen Filter von einem tatsächlich leeren Ergebnis unterscheiden können. Nur lesen; ändern Sie nichts.`,
    },
  },
  {
    key: "base-bulk-import",
    label: {
      en: "Bulk-add records",
      "zh-CN": "批量录入数据",
      "zh-TW": "批次錄入資料",
      ja: "レコードを一括追加",
      ko: "레코드 일괄 추가",
      es: "Añadir registros en bloque",
      pt: "Adicionar registros em lote",
      vi: "Thêm hàng loạt bản ghi",
      fr: "Ajouter des enregistrements en masse",
      de: "Datensätze in großer Zahl hinzufügen",
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
      ko: (t) =>
        `${t}\n\n레코드를 일괄로 추가하고 싶어요. 먼저 필드 구성을 읽고, 제가 드리는 내용을 각 필드에 맞춰 매핑해 주세요. 기존 레코드와 중복으로 보이는 항목은 쓰기 전에 저에게 먼저 확인해 주세요.`,
      es: (t) =>
        `${t}\n\nQuiero añadir registros en bloque. Lee primero el esquema de campos y luego asigna lo que te dé a esos campos. Señala todo lo que parezca un duplicado de un registro existente y pregúntame antes de escribirlo.`,
      pt: (t) =>
        `${t}\n\nQuero adicionar registros em lote. Leia primeiro o esquema de campos e depois mapeie o que eu passar para esses campos. Sinalize tudo que parecer duplicata de um registro existente e me pergunte antes de gravar.`,
      vi: (t) =>
        `${t}\n\nTôi muốn thêm hàng loạt bản ghi. Trước tiên hãy đọc cấu trúc trường, rồi ánh xạ những gì tôi đưa cho bạn vào các trường đó. Nếu có gì trông như trùng với một bản ghi đã có, hãy đánh dấu và hỏi tôi trước khi ghi.`,
      fr: (t) =>
        `${t}\n\nJe veux ajouter des enregistrements en masse. Lisez d'abord le schéma des champs, puis associez ce que je vous donne à ces champs. Signalez tout ce qui ressemble à un doublon d'un enregistrement existant et demandez-moi avant de l'écrire.`,
      de: (t) =>
        `${t}\n\nIch möchte Datensätze in großer Zahl hinzufügen. Lesen Sie zuerst das Feldschema und ordnen Sie dann das, was ich Ihnen gebe, diesen Feldern zu. Markieren Sie alles, was wie ein Duplikat eines vorhandenen Datensatzes aussieht, und fragen Sie mich, bevor Sie es schreiben.`,
    },
  },
  {
    key: "base-design-schema",
    label: {
      en: "Design the schema for me",
      "zh-CN": "帮我设计表结构",
      "zh-TW": "幫我設計表結構",
      ja: "スキーマを設計してもらう",
      ko: "스키마 설계 맡기기",
      es: "Diseñar el esquema por mí",
      pt: "Projetar o esquema para mim",
      vi: "Thiết kế cấu trúc giúp tôi",
      fr: "Concevoir le schéma pour moi",
      de: "Das Schema für mich entwerfen",
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
      ko: (t) =>
        `${t}\n\n제가 관리하려는 내용을 설명할게요. 그에 맞는 필드 구성(필드 이름, 유형, 각 필드가 필요한 이유)을 제안하고, 필드를 만들거나 바꾸기 전에 반드시 제안서를 먼저 보여 주세요.`,
      es: (t) =>
        `${t}\n\nTe describiré qué necesito registrar. Propón un esquema de campos para ello (nombres de campo, tipos y el porqué de cada uno) y enséñame la propuesta antes de crear o cambiar ningún campo.`,
      pt: (t) =>
        `${t}\n\nVou descrever o que preciso acompanhar. Proponha um esquema de campos para isso — nomes de campo, tipos e o motivo de cada um — e me mostre a proposta antes de criar ou alterar qualquer campo.`,
      vi: (t) =>
        `${t}\n\nTôi sẽ mô tả những gì tôi cần theo dõi. Hãy đề xuất một cấu trúc trường cho việc đó — tên trường, kiểu và lý do cho từng trường — và cho tôi xem đề xuất trước khi tạo hoặc thay đổi bất kỳ trường nào.`,
      fr: (t) =>
        `${t}\n\nJe vais décrire ce que je dois suivre. Proposez-moi un schéma de champs adapté — noms des champs, types et raison d'être de chacun — et montrez-moi la proposition avant de créer ou de modifier le moindre champ.`,
      de: (t) =>
        `${t}\n\nIch beschreibe, was ich erfassen muss. Schlagen Sie dafür ein Feldschema vor – Feldnamen, Typen und wozu jedes Feld dient – und zeigen Sie mir den Vorschlag, bevor Sie ein Feld anlegen oder ändern.`,
    },
  },
  {
    key: "base-dedupe",
    label: {
      en: "Find and clean duplicates",
      "zh-CN": "清理重复记录",
      "zh-TW": "清理重複記錄",
      ja: "重複レコードを整理",
      ko: "중복 레코드 정리",
      es: "Encontrar y limpiar duplicados",
      pt: "Encontrar e limpar duplicatas",
      vi: "Tìm và dọn bản ghi trùng lặp",
      fr: "Trouver et nettoyer les doublons",
      de: "Duplikate finden und bereinigen",
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
      ko: (t) =>
        `${t}\n\n레코드에서 중복 및 유사 중복을 찾아 주세요. 찾은 그룹과 각 그룹을 어떻게 병합하거나 삭제할지 정리해서 보여 주시고, 제가 선택하기 전에는 아무것도 변경하지 마세요.`,
      es: (t) =>
        `${t}\n\nRevisa los registros en busca de duplicados y casi duplicados. Enumera lo que encuentres y cómo fusionarías o eliminarías cada grupo; no cambies nada hasta que yo elija.`,
      pt: (t) =>
        `${t}\n\nAnalise os registros em busca de duplicatas e quase-duplicatas. Liste o que encontrou e como você mesclaria ou removeria cada grupo — não altere nada até eu escolher.`,
      vi: (t) =>
        `${t}\n\nHãy quét các bản ghi để tìm bản trùng và gần trùng. Liệt kê những gì bạn tìm thấy và cách bạn sẽ hợp nhất hoặc xóa từng nhóm — đừng thay đổi gì cho đến khi tôi chọn.`,
      fr: (t) =>
        `${t}\n\nAnalysez les enregistrements pour repérer les doublons et quasi-doublons. Listez ce que vous avez trouvé et comment vous fusionneriez ou supprimeriez chaque groupe — ne modifiez rien tant que je n'ai pas choisi.`,
      de: (t) =>
        `${t}\n\nDurchsuchen Sie die Datensätze nach Duplikaten und Beinahe-Duplikaten. Listen Sie auf, was Sie gefunden haben und wie Sie jede Gruppe zusammenführen oder entfernen würden – ändern Sie nichts, bevor ich entschieden habe.`,
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
      ko: "요약하고 보고서 만들기",
      es: "Resumir y hacer un informe",
      pt: "Resumir e gerar um relatório",
      vi: "Tổng hợp và làm báo cáo",
      fr: "Résumer et faire un rapport",
      de: "Zusammenfassen und Bericht erstellen",
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
      ko: (t) =>
        `${t}\n\n레코드를 읽고 요약해 주세요. 핵심 수치, 눈에 띄는 패턴, 이상해 보이는 점을 알려 주세요. 읽기 전용 작업이므로 데이터를 수정하지 마세요.`,
      es: (t) =>
        `${t}\n\nLee los registros y hazme un resumen: las cifras clave, los patrones destacables y cualquier cosa que parezca rara. Es solo lectura: no modifiques los datos.`,
      pt: (t) =>
        `${t}\n\nLeia os registros e me dê um resumo: os números principais, padrões relevantes e qualquer coisa que pareça estranha. É somente leitura — não modifique os dados.`,
      vi: (t) =>
        `${t}\n\nHãy đọc các bản ghi và tóm tắt cho tôi: các con số chính, những xu hướng đáng chú ý và bất cứ điều gì trông bất thường. Đây là tác vụ chỉ đọc — đừng sửa dữ liệu.`,
      fr: (t) =>
        `${t}\n\nLisez les enregistrements et faites-m'en un résumé : les chiffres clés, les tendances notables et tout ce qui semble anormal. C'est en lecture seule — ne modifiez pas les données.`,
      de: (t) =>
        `${t}\n\nLesen Sie die Datensätze und geben Sie mir eine Zusammenfassung: die wichtigsten Zahlen, auffällige Muster und alles, was seltsam aussieht. Das ist nur lesend – ändern Sie die Daten nicht.`,
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
    ko: "문서 읽기",
    es: "Leer documento",
    pt: "Ler documento",
    vi: "Đọc tài liệu",
    fr: "Lire le document",
    de: "Dokument lesen",
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
    ko: (t) =>
      `${t}\n\n이 문서의 현재 내용을 처음부터 끝까지 읽고, 제 다음 요청을 위해 컨텍스트로 유지해 주세요. 읽기 전용 작업입니다. 문서를 수정하거나 ChangeRequest를 만들거나 무언가를 병합하지 마세요. 다 읽은 뒤에는 준비되었음을 간단히 알려 주세요.`,
    es: (t) =>
      `${t}\n\nLee el contenido actual de este documento completo y mantenlo en contexto para mi siguiente petición. Es una tarea de solo lectura: no modifiques el documento, no crees ninguna ChangeRequest ni fusiones nada. Cuando termines de leerlo, confirma brevemente que estás listo.`,
    pt: (t) =>
      `${t}\n\nLeia o conteúdo atual deste documento por completo e mantenha-o em contexto para o meu próximo pedido. Esta é uma tarefa somente de leitura: não modifique o documento, não crie nenhuma ChangeRequest nem mescle nada. Depois de ler, confirme brevemente que você está pronto.`,
    vi: (t) =>
      `${t}\n\nHãy đọc toàn bộ nội dung hiện tại của tài liệu này và giữ nó trong ngữ cảnh cho yêu cầu tiếp theo của tôi. Đây là tác vụ chỉ đọc: đừng sửa tài liệu, đừng tạo ChangeRequest và đừng hợp nhất bất cứ thứ gì. Đọc xong, hãy xác nhận ngắn gọn là bạn đã sẵn sàng.`,
    fr: (t) =>
      `${t}\n\nLisez en entier le contenu actuel de ce document et gardez-le en contexte pour ma prochaine demande. Il s'agit d'une tâche en lecture seule : ne modifiez pas le document, ne créez pas de ChangeRequest et ne fusionnez rien. Après l'avoir lu, confirmez brièvement que vous êtes prêt.`,
    de: (t) =>
      `${t}\n\nLesen Sie den aktuellen Inhalt dieses Dokuments vollständig und behalten Sie ihn für meine nächste Anfrage im Kontext. Das ist eine reine Leseaufgabe: Ändern Sie das Dokument nicht, erstellen Sie keine ChangeRequest und führen Sie nichts zusammen. Bestätigen Sie nach dem Lesen kurz, dass Sie bereit sind.`,
  },
};

const DOC_SCENARIOS: PromptDef[] = [
  {
    key: "doc-ask",
    intent: "read-only",
    label: {
      en: "Answer my question from this doc",
      "zh-CN": "根据这篇文档回答我",
      "zh-TW": "根據這篇文件回答我",
      ja: "この文書に基づいて答えて",
      ko: "이 문서를 바탕으로 답해 주기",
      es: "Responder a mi pregunta con este documento",
      pt: "Responder à minha pergunta com base neste documento",
      vi: "Trả lời câu hỏi của tôi dựa trên tài liệu này",
      fr: "Répondre à ma question à partir de ce document",
      de: "Meine Frage anhand dieses Dokuments beantworten",
    },
    body: {
      en: (t) =>
        `${t}\n\nRead this doc, then answer the question I ask next using only what it actually says. Quote the part you are relying on. If the doc does not answer it, say so instead of filling the gap from your own knowledge. Read-only.`,
      "zh-CN": (t) =>
        `${t}\n\n请读这篇文档，然后只依据它里面真正写了的内容回答我接下来的问题，并引用你依据的那一段。如果文档里没写，就直接说没写，不要用你自己的知识补上。只读，不要改动。`,
      "zh-TW": (t) =>
        `${t}\n\n請讀這篇文件，然後只依據它裡面真正寫了的內容回答我接下來的問題，並引用你依據的那一段。如果文件裡沒寫，就直接說沒寫，不要用你自己的知識補上。唯讀，不要改動。`,
      ja: (t) =>
        `${t}\n\nこの文書を読み、次の質問には文書に実際に書かれている内容だけで答えてください。根拠にした箇所を引用してください。文書が答えていない場合は、自分の知識で埋めずに「書かれていない」と伝えてください。読み取り専用です。`,
      ko: (t) =>
        `${t}\n\n이 문서를 읽고, 제가 다음에 하는 질문에 문서에 실제로 적힌 내용만으로 답해 주세요. 근거로 삼은 부분을 인용해 주세요. 문서에 답이 없으면 자신의 지식으로 빈틈을 메우지 말고 없다고 말해 주세요. 읽기 전용입니다.`,
      es: (t) =>
        `${t}\n\nLee este documento y luego responde a la pregunta que te haga a continuación usando solo lo que dice realmente. Cita la parte en la que te apoyas. Si el documento no la responde, dilo en lugar de rellenar el hueco con tu propio conocimiento. Solo lectura.`,
      pt: (t) =>
        `${t}\n\nLeia este documento e depois responda à pergunta que eu fizer em seguida usando apenas o que ele realmente diz. Cite o trecho em que você se baseia. Se o documento não responder, diga isso em vez de preencher a lacuna com o seu próprio conhecimento. Somente leitura.`,
      vi: (t) =>
        `${t}\n\nHãy đọc tài liệu này, rồi trả lời câu hỏi tiếp theo của tôi chỉ dựa trên những gì tài liệu thực sự viết. Trích dẫn phần bạn dựa vào. Nếu tài liệu không trả lời được, hãy nói rõ như vậy thay vì lấp chỗ trống bằng kiến thức của riêng bạn. Chỉ đọc.`,
      fr: (t) =>
        `${t}\n\nLisez ce document, puis répondez à la question que je poserai ensuite en vous appuyant uniquement sur ce qu'il dit réellement. Citez le passage sur lequel vous vous appuyez. Si le document n'y répond pas, dites-le au lieu de combler le manque avec vos propres connaissances. Lecture seule.`,
      de: (t) =>
        `${t}\n\nLesen Sie dieses Dokument und beantworten Sie dann die Frage, die ich als Nächstes stelle, ausschließlich mit dem, was tatsächlich darin steht. Zitieren Sie die Stelle, auf die Sie sich stützen. Wenn das Dokument die Frage nicht beantwortet, sagen Sie das, statt die Lücke mit eigenem Wissen zu füllen. Nur lesend.`,
    },
  },
  {
    key: "doc-draft",
    label: {
      en: "Draft / expand this doc",
      "zh-CN": "起草或扩写这篇文档",
      "zh-TW": "起草或擴寫這篇文件",
      ja: "この文書を起草・加筆",
      ko: "이 문서 초안 작성·보강",
      es: "Redactar o ampliar este documento",
      pt: "Redigir ou ampliar este documento",
      vi: "Soạn thảo / mở rộng tài liệu này",
      fr: "Rédiger ou développer ce document",
      de: "Dieses Dokument entwerfen bzw. erweitern",
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
      ko: (t) =>
        `${t}\n\n현재 내용을 읽은 다음, 제가 이어서 알려 드리는 내용에 따라 초안을 쓰거나 내용을 보강해 주세요. 달리 요청하지 않는 한 기존 구조와 어조를 유지해 주세요.`,
      es: (t) =>
        `${t}\n\nLee el contenido actual y luego redáctalo o amplíalo según lo que te diga a continuación. Mantén la estructura y el tono existentes salvo que te pida otra cosa.`,
      pt: (t) =>
        `${t}\n\nLeia o conteúdo atual e depois redija ou amplie-o com base no que eu disser em seguida. Mantenha a estrutura e o tom existentes, a menos que eu peça outra coisa.`,
      vi: (t) =>
        `${t}\n\nHãy đọc nội dung hiện tại, rồi soạn thảo hoặc mở rộng nó dựa trên những gì tôi nói tiếp theo. Giữ nguyên cấu trúc và giọng văn hiện có trừ khi tôi yêu cầu khác.`,
      fr: (t) =>
        `${t}\n\nLisez le contenu actuel, puis rédigez-le ou développez-le d'après ce que je vous dirai ensuite. Conservez la structure et le ton existants sauf si je demande autre chose.`,
      de: (t) =>
        `${t}\n\nLesen Sie den aktuellen Inhalt und entwerfen oder erweitern Sie ihn dann anhand dessen, was ich Ihnen als Nächstes sage. Behalten Sie die vorhandene Struktur und den Ton bei, sofern ich nichts anderes verlange.`,
    },
  },
  {
    key: "doc-review",
    label: {
      en: "Review and suggest edits",
      "zh-CN": "审阅并提出修改建议",
      "zh-TW": "審閱並提出修改建議",
      ja: "レビューして修正案を出す",
      ko: "검토하고 수정안 제시",
      es: "Revisar y sugerir cambios",
      pt: "Revisar e sugerir alterações",
      vi: "Xem xét và đề xuất chỉnh sửa",
      fr: "Relire et suggérer des modifications",
      de: "Prüfen und Änderungen vorschlagen",
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
      ko: (t) =>
        `${t}\n\n이 문서를 명확성, 빠진 내용, 사실 관계가 불확실한 부분 관점에서 검토해 주세요. 먼저 수정 제안을 목록으로 보여 주시고, 제가 어떤 것을 적용할지 말하기 전에는 문서를 고쳐 쓰지 마세요.`,
      es: (t) =>
        `${t}\n\nRevisa este documento en cuanto a claridad, lagunas y cualquier dato dudoso. Dame primero las ediciones sugeridas en una lista; no lo reescribas hasta que te diga cuáles aplicar.`,
      pt: (t) =>
        `${t}\n\nRevise este documento quanto a clareza, lacunas e qualquer coisa factualmente duvidosa. Me dê primeiro as edições sugeridas em uma lista — não reescreva até eu dizer quais aplicar.`,
      vi: (t) =>
        `${t}\n\nHãy xem xét tài liệu này về độ rõ ràng, những chỗ còn thiếu và bất cứ điều gì thiếu chắc chắn về mặt sự thật. Trước hết hãy đưa cho tôi các chỉnh sửa đề xuất dưới dạng danh sách — đừng viết lại cho đến khi tôi nói áp dụng mục nào.`,
      fr: (t) =>
        `${t}\n\nRelisez ce document en vérifiant la clarté, les lacunes et tout ce qui semble factuellement fragile. Donnez-moi d'abord les modifications suggérées sous forme de liste — ne le réécrivez pas tant que je n'ai pas dit lesquelles appliquer.`,
      de: (t) =>
        `${t}\n\nPrüfen Sie dieses Dokument auf Klarheit, Lücken und alles, was sachlich wackelig ist. Geben Sie mir die vorgeschlagenen Änderungen zuerst als Liste – schreiben Sie nichts um, bevor ich sage, welche Sie anwenden sollen.`,
    },
  },
];

const DRIVE_SCENARIOS: PromptDef[] = [
  {
    key: "drive-find",
    intent: "read-only",
    label: {
      en: "Find something in these files",
      "zh-CN": "在这些文件里找东西",
      "zh-TW": "在這些檔案裡找東西",
      ja: "ファイルの中から探す",
      ko: "파일에서 찾기",
      es: "Buscar algo en estos archivos",
      pt: "Encontrar algo nestes arquivos",
      vi: "Tìm thứ gì đó trong các tệp này",
      fr: "Chercher quelque chose dans ces fichiers",
      de: "Etwas in diesen Dateien finden",
    },
    body: {
      en: (t) =>
        `${t}\n\nI'll tell you what I'm looking for. Search these files and tell me which file it is in and where, quoting enough of it that I can tell you found the right thing. If it is in several places, list them all rather than picking one. Read-only.`,
      "zh-CN": (t) =>
        `${t}\n\n我接下来告诉你我要找什么。请在这些文件里检索，告诉我它在哪个文件、哪个位置，并引用足够的原文让我能判断你找对了。如果多处都有，请全部列出，不要只挑一个。只读，不要改动。`,
      "zh-TW": (t) =>
        `${t}\n\n我接下來告訴你我要找什麼。請在這些檔案裡檢索，告訴我它在哪個檔案、哪個位置，並引用足夠的原文讓我能判斷你找對了。如果多處都有，請全部列出，不要只挑一個。唯讀，不要改動。`,
      ja: (t) =>
        `${t}\n\n次に探しているものを伝えます。これらのファイルを検索し、どのファイルのどこにあるかを、正しいものを見つけたと私が判断できるだけの原文を引用して教えてください。複数箇所にあるなら、ひとつ選ばず全部挙げてください。読み取り専用です。`,
      ko: (t) =>
        `${t}\n\n제가 찾는 것을 알려 드릴게요. 이 파일들을 검색해서 어느 파일의 어디에 있는지 알려 주세요. 제대로 찾았는지 제가 판단할 수 있도록 원문을 충분히 인용해 주세요. 여러 곳에 있으면 하나만 고르지 말고 모두 나열해 주세요. 읽기 전용입니다.`,
      es: (t) =>
        `${t}\n\nTe diré lo que busco. Busca en estos archivos y dime en qué archivo está y en qué parte, citando lo suficiente para que yo pueda comprobar que encontraste lo correcto. Si está en varios sitios, enuméralos todos en lugar de elegir uno. Solo lectura.`,
      pt: (t) =>
        `${t}\n\nVou dizer o que estou procurando. Pesquise nestes arquivos e me diga em qual arquivo está e onde, citando o suficiente para eu perceber que você achou a coisa certa. Se estiver em vários lugares, liste todos em vez de escolher um. Somente leitura.`,
      vi: (t) =>
        `${t}\n\nTôi sẽ cho bạn biết tôi đang tìm gì. Hãy tìm trong các tệp này và cho tôi biết nó nằm ở tệp nào, ở đâu, trích dẫn đủ để tôi biết bạn đã tìm đúng. Nếu nó xuất hiện ở nhiều chỗ, hãy liệt kê tất cả thay vì chọn một. Chỉ đọc.`,
      fr: (t) =>
        `${t}\n\nJe vais vous dire ce que je cherche. Parcourez ces fichiers et indiquez-moi dans quel fichier et à quel endroit cela se trouve, en citant assez de texte pour que je puisse constater que vous avez trouvé le bon élément. Si cela figure à plusieurs endroits, listez-les tous au lieu d'en choisir un. Lecture seule.`,
      de: (t) =>
        `${t}\n\nIch sage Ihnen, wonach ich suche. Durchsuchen Sie diese Dateien und sagen Sie mir, in welcher Datei und an welcher Stelle es steht, und zitieren Sie genug davon, damit ich erkennen kann, dass Sie das Richtige gefunden haben. Wenn es an mehreren Stellen steht, listen Sie alle auf, statt eine auszuwählen. Nur lesend.`,
    },
  },
  {
    key: "drive-organize",
    label: {
      en: "Organize these files",
      "zh-CN": "整理这些文件",
      "zh-TW": "整理這些檔案",
      ja: "ファイルを整理",
      ko: "파일 정리",
      es: "Organizar estos archivos",
      pt: "Organizar estes arquivos",
      vi: "Sắp xếp các tệp này",
      fr: "Organiser ces fichiers",
      de: "Diese Dateien ordnen",
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
      ko: (t) =>
        `${t}\n\n여기에 무엇이 있는지 목록으로 정리한 다음, 이름 짓기와 그룹 나누기를 포함한 더 깔끔한 구조를 제안해 주세요. 무언가를 옮기거나 이름을 바꾸기 전에 반드시 계획을 먼저 보여 주세요.`,
      es: (t) =>
        `${t}\n\nEnumera lo que hay aquí y propón una estructura más limpia, con nombres y agrupaciones. Enséñame el plan antes de mover o renombrar nada.`,
      pt: (t) =>
        `${t}\n\nListe o que há aqui e proponha uma estrutura mais limpa, com nomes e agrupamentos. Mostre o plano antes de mover ou renomear qualquer coisa.`,
      vi: (t) =>
        `${t}\n\nHãy liệt kê những gì có ở đây, rồi đề xuất một cấu trúc gọn gàng hơn — cách đặt tên và nhóm. Cho tôi xem kế hoạch trước khi di chuyển hoặc đổi tên bất cứ thứ gì.`,
      fr: (t) =>
        `${t}\n\nListez ce qui se trouve ici, puis proposez une structure plus claire — nommage et regroupement. Montrez-moi le plan avant de déplacer ou de renommer quoi que ce soit.`,
      de: (t) =>
        `${t}\n\nListen Sie auf, was sich hier befindet, und schlagen Sie dann eine übersichtlichere Struktur vor – Benennung und Gruppierung. Zeigen Sie mir den Plan, bevor Sie etwas verschieben oder umbenennen.`,
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
      ko: "내용 요약",
      es: "Resumir el contenido",
      pt: "Resumir o conteúdo",
      vi: "Tóm tắt nội dung",
      fr: "Résumer le contenu",
      de: "Den Inhalt zusammenfassen",
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
      ko: (t) =>
        `${t}\n\n파일을 훑어보고 무엇이 들어 있는지 알려 주세요. 각 파일의 용도와 오래되었거나 중복된 것이 있는지도 함께 알려 주세요. 읽기 전용입니다.`,
      es: (t) =>
        `${t}\n\nLee los archivos y cuéntame qué hay aquí: para qué sirve cada uno y qué está obsoleto o es redundante. Solo lectura.`,
      pt: (t) =>
        `${t}\n\nLeia os arquivos e me diga o que há aqui — para que serve cada um e o que está desatualizado ou redundante. Somente leitura.`,
      vi: (t) =>
        `${t}\n\nHãy đọc qua các tệp và cho tôi biết có gì ở đây — mỗi tệp dùng để làm gì, và tệp nào đã lỗi thời hoặc thừa. Chỉ đọc.`,
      fr: (t) =>
        `${t}\n\nParcourez les fichiers et dites-moi ce qu'ils contiennent — à quoi sert chacun, et ce qui est obsolète ou redondant. Lecture seule.`,
      de: (t) =>
        `${t}\n\nLesen Sie die Dateien durch und sagen Sie mir, was hier drin ist – wofür jede Datei gedacht ist und was veraltet oder überflüssig ist. Nur lesend.`,
    },
  },
];

/**
 * A Skill node is a CAPABILITY, and the thing people do with a capability is use
 * it. This list opened with "Improve this skill" and had nothing else — every
 * prompt on offer treated the reader as the skill's maintainer, when almost
 * everyone opening one is a person who wants it to do its job for them. Running
 * it comes first now; improving it is still here, third, for the author.
 */
const SKILL_SCENARIOS: PromptDef[] = [
  {
    key: "skill-run",
    label: {
      en: "Use this skill",
      "zh-CN": "调用这个 Skill",
      "zh-TW": "呼叫這個 Skill",
      ja: "この Skill を実行",
      ko: "이 스킬 사용하기",
      es: "Usar esta skill",
      pt: "Usar esta skill",
      vi: "Dùng kỹ năng này",
      fr: "Utiliser cette compétence",
      de: "Diesen Skill verwenden",
    },
    body: {
      en: (t) =>
        `${t}\n\nRead this skill's \`SKILL.md\` and any reference files it points at, then follow its workflow to do what I describe next. Follow the skill's own rules over your usual habits, and tell me if it says something you cannot do here.`,
      "zh-CN": (t) =>
        `${t}\n\n请读这个 skill 的 \`SKILL.md\` 以及它引用的参考文件，然后按它写的流程完成我接下来描述的任务。以这个 skill 自己的规则为准，不要用你平时的习惯覆盖它；如果它要求的事情你在这里做不到，直接告诉我。`,
      "zh-TW": (t) =>
        `${t}\n\n請讀這個 skill 的 \`SKILL.md\` 以及它引用的參考檔案，然後按它寫的流程完成我接下來描述的任務。以這個 skill 自己的規則為準，不要用你平時的習慣覆蓋它；如果它要求的事情你在這裡做不到，直接告訴我。`,
      ja: (t) =>
        `${t}\n\nこの skill の \`SKILL.md\` と参照ファイルを読み、そのワークフローに従って次に説明する作業を行ってください。あなたの通常のやり方より skill 自身のルールを優先し、ここでは実行できないことが書かれていれば教えてください。`,
      ko: (t) =>
        `${t}\n\n이 스킬의 \`SKILL.md\`와 그것이 가리키는 참고 파일을 읽은 다음, 그 워크플로에 따라 제가 이어서 설명하는 작업을 해 주세요. 평소 습관보다 스킬 자체의 규칙을 우선하고, 여기서 할 수 없는 일이 적혀 있으면 알려 주세요.`,
      es: (t) =>
        `${t}\n\nLee el \`SKILL.md\` de esta skill y los archivos de referencia a los que apunte, y luego sigue su flujo de trabajo para hacer lo que te describa a continuación. Da prioridad a las reglas propias de la skill sobre tus hábitos de siempre y dime si indica algo que aquí no puedes hacer.`,
      pt: (t) =>
        `${t}\n\nLeia o \`SKILL.md\` desta skill e os arquivos de referência para os quais ele aponta, depois siga o fluxo de trabalho dela para fazer o que eu descrever em seguida. Priorize as regras da própria skill em vez dos seus hábitos de sempre e me avise se ela disser algo que você não pode fazer aqui.`,
      vi: (t) =>
        `${t}\n\nHãy đọc \`SKILL.md\` của kỹ năng này và mọi tệp tham chiếu mà nó trỏ tới, rồi làm theo quy trình của nó để thực hiện việc tôi mô tả tiếp theo. Hãy ưu tiên quy tắc riêng của kỹ năng hơn thói quen thường ngày của bạn, và cho tôi biết nếu nó yêu cầu điều gì mà bạn không làm được ở đây.`,
      fr: (t) =>
        `${t}\n\nLisez le \`SKILL.md\` de cette compétence et les fichiers de référence vers lesquels il pointe, puis suivez son workflow pour faire ce que je décrirai ensuite. Faites passer les règles propres à la compétence avant vos habitudes, et dites-moi si elle demande quelque chose que vous ne pouvez pas faire ici.`,
      de: (t) =>
        `${t}\n\nLesen Sie die \`SKILL.md\` dieses Skills und alle Referenzdateien, auf die sie verweist, und folgen Sie dann seinem Workflow, um das zu erledigen, was ich als Nächstes beschreibe. Stellen Sie die eigenen Regeln des Skills über Ihre üblichen Gewohnheiten und sagen Sie mir, wenn dort etwas steht, das Sie hier nicht tun können.`,
    },
  },
  {
    key: "skill-explain",
    intent: "read-only",
    label: {
      en: "What can this do for me?",
      "zh-CN": "这个 Skill 能帮我做什么？",
      "zh-TW": "這個 Skill 能幫我做什麼？",
      ja: "これで何ができる？",
      ko: "이걸로 무엇을 할 수 있나요?",
      es: "¿Qué puede hacer por mí?",
      pt: "O que isto pode fazer por mim?",
      vi: "Kỹ năng này giúp được gì cho tôi?",
      fr: "Que peut-elle faire pour moi ?",
      de: "Was kann er für mich tun?",
    },
    body: {
      en: (t) =>
        `${t}\n\nRead this skill and tell me in plain language what it does, when I should reach for it, and what it needs from me before it can run — credentials, data, a decision. Read-only; don't run it or change it yet.`,
      "zh-CN": (t) =>
        `${t}\n\n请读这个 skill，用大白话告诉我：它是干什么的、什么时候该用它、以及在它能跑起来之前需要我先准备什么（凭据、数据、还是某个决定）。只读——先别执行它，也别改它。`,
      "zh-TW": (t) =>
        `${t}\n\n請讀這個 skill，用白話告訴我：它是做什麼的、什麼時候該用它、以及在它能跑起來之前需要我先準備什麼（憑證、資料、還是某個決定）。唯讀——先別執行它，也別改它。`,
      ja: (t) =>
        `${t}\n\nこの skill を読んで、平易な言葉で教えてください：何をするものか、どんなときに使うべきか、動かす前に私が用意すべきもの（認証情報・データ・判断）は何か。読み取り専用——まだ実行も変更もしないでください。`,
      ko: (t) =>
        `${t}\n\n이 스킬을 읽고, 어떤 일을 하는지, 언제 쓰면 좋은지, 실행하기 전에 제가 준비해야 할 것(자격 증명, 데이터, 결정 사항)이 무엇인지 쉬운 말로 알려 주세요. 읽기 전용이므로 아직 실행하거나 수정하지 마세요.`,
      es: (t) =>
        `${t}\n\nLee esta skill y cuéntame con palabras sencillas qué hace, cuándo debería recurrir a ella y qué necesita de mí antes de poder ejecutarse: credenciales, datos, una decisión. Solo lectura; todavía no la ejecutes ni la cambies.`,
      pt: (t) =>
        `${t}\n\nLeia esta skill e me diga em linguagem simples o que ela faz, quando devo recorrer a ela e o que ela precisa de mim antes de poder rodar — credenciais, dados, uma decisão. Somente leitura; ainda não a execute nem a altere.`,
      vi: (t) =>
        `${t}\n\nHãy đọc kỹ năng này và cho tôi biết bằng lời dễ hiểu: nó làm gì, khi nào tôi nên dùng và nó cần gì từ tôi trước khi chạy được — thông tin xác thực, dữ liệu hay một quyết định. Chỉ đọc; chưa chạy hay sửa nó vội.`,
      fr: (t) =>
        `${t}\n\nLisez cette compétence et expliquez-moi en langage simple ce qu'elle fait, quand je devrais y recourir et ce dont elle a besoin de ma part avant de pouvoir s'exécuter — identifiants, données, une décision. Lecture seule ; ne l'exécutez pas et ne la modifiez pas pour l'instant.`,
      de: (t) =>
        `${t}\n\nLesen Sie diesen Skill und erklären Sie mir in einfachen Worten, was er tut, wann ich ihn einsetzen sollte und was er von mir braucht, bevor er laufen kann – Zugangsdaten, Daten, eine Entscheidung. Nur lesend; führen Sie ihn noch nicht aus und ändern Sie ihn nicht.`,
    },
  },
  {
    key: "skill-improve",
    label: {
      en: "Improve this skill",
      "zh-CN": "改进这个 Skill",
      "zh-TW": "改進這個 Skill",
      ja: "この Skill を改善",
      ko: "이 스킬 개선하기",
      es: "Mejorar esta skill",
      pt: "Melhorar esta skill",
      vi: "Cải thiện kỹ năng này",
      fr: "Améliorer cette compétence",
      de: "Diesen Skill verbessern",
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
      ko: (t) =>
        `${t}\n\n이 스킬의 파일을 읽고, 지침이 모호하거나 빠져 있거나 에이전트가 잘못 읽기 쉬운 부분을 알려 주세요. 무언가를 바꾸기 전에 구체적인 수정안을 먼저 제안해 주세요.`,
      es: (t) =>
        `${t}\n\nLee los archivos de esta skill y dime dónde las instrucciones son ambiguas, faltan o un agente podría malinterpretarlas. Propón cambios concretos antes de modificar nada.`,
      pt: (t) =>
        `${t}\n\nLeia os arquivos desta skill e me diga onde as instruções são ambíguas, estão faltando ou podem ser mal interpretadas por um agente. Proponha alterações concretas antes de mudar qualquer coisa.`,
      vi: (t) =>
        `${t}\n\nHãy đọc các tệp của kỹ năng này và chỉ ra chỗ nào hướng dẫn còn mơ hồ, thiếu hoặc dễ bị tác nhân AI hiểu sai. Hãy đề xuất các chỉnh sửa cụ thể trước khi thay đổi bất cứ thứ gì.`,
      fr: (t) =>
        `${t}\n\nLisez les fichiers de cette compétence et dites-moi où les instructions sont ambiguës, manquantes ou risquent d'être mal comprises par un agent. Proposez des modifications concrètes avant de changer quoi que ce soit.`,
      de: (t) =>
        `${t}\n\nLesen Sie die Dateien dieses Skills und sagen Sie mir, wo die Anweisungen mehrdeutig sind, fehlen oder von einem Agent leicht falsch verstanden werden könnten. Schlagen Sie konkrete Änderungen vor, bevor Sie etwas ändern.`,
    },
  },
];

const AIRAPP_SCENARIOS: PromptDef[] = [
  {
    key: "airapp-explain",
    intent: "read-only",
    label: {
      en: "What does this app do?",
      "zh-CN": "这个应用是干什么的？",
      "zh-TW": "這個應用是做什麼的？",
      ja: "このアプリは何をする？",
      ko: "이 앱은 무엇을 하나요?",
      es: "¿Qué hace esta app?",
      pt: "O que este app faz?",
      vi: "Ứng dụng này làm gì?",
      fr: "Que fait cette application ?",
      de: "Was macht diese App?",
    },
    body: {
      en: (t) =>
        `${t}\n\nRead the app's source and the tables it reads, then tell me what it is for, who it is for, and which data it shows or writes. I want to understand it before I change it. Read-only.`,
      "zh-CN": (t) =>
        `${t}\n\n请读这个应用的代码，以及它读取的那些表，然后告诉我：它是干什么的、给谁用的、展示和写入的分别是哪些数据。我想先看懂它，再谈改它。只读，不要改动。`,
      "zh-TW": (t) =>
        `${t}\n\n請讀這個應用的程式碼，以及它讀取的那些表，然後告訴我：它是做什麼的、給誰用的、展示和寫入的分別是哪些資料。我想先看懂它，再談改它。唯讀，不要改動。`,
      ja: (t) =>
        `${t}\n\nこのアプリのコードと、それが読んでいるテーブルを読んだうえで、何のためのアプリか、誰向けか、どのデータを表示・書き込みするかを教えてください。変更する前にまず理解したいです。読み取り専用です。`,
      ko: (t) =>
        `${t}\n\n앱의 소스 코드와 앱이 읽는 테이블을 읽은 다음, 무엇을 위한 앱인지, 누구를 위한 것인지, 어떤 데이터를 보여 주거나 기록하는지 알려 주세요. 바꾸기 전에 먼저 이해하고 싶어요. 읽기 전용입니다.`,
      es: (t) =>
        `${t}\n\nLee el código fuente de la app y las tablas que lee, y luego dime para qué sirve, para quién es y qué datos muestra o escribe. Quiero entenderla antes de cambiarla. Solo lectura.`,
      pt: (t) =>
        `${t}\n\nLeia o código-fonte do app e as tabelas que ele lê e depois me diga para que ele serve, para quem é e quais dados ele mostra ou grava. Quero entendê-lo antes de alterá-lo. Somente leitura.`,
      vi: (t) =>
        `${t}\n\nHãy đọc mã nguồn của ứng dụng và các bảng mà nó đọc, rồi cho tôi biết nó dùng để làm gì, dành cho ai, và hiển thị hay ghi những dữ liệu nào. Tôi muốn hiểu nó trước khi thay đổi. Chỉ đọc.`,
      fr: (t) =>
        `${t}\n\nLisez le code source de l'application et les tables qu'elle lit, puis dites-moi à quoi elle sert, à qui elle s'adresse et quelles données elle affiche ou écrit. Je veux la comprendre avant de la modifier. Lecture seule.`,
      de: (t) =>
        `${t}\n\nLesen Sie den Quellcode der App und die Tabellen, die sie liest, und sagen Sie mir dann, wofür sie gedacht ist, für wen sie gedacht ist und welche Daten sie anzeigt oder schreibt. Ich möchte sie verstehen, bevor ich sie ändere. Nur lesend.`,
    },
  },
  {
    key: "airapp-add-feature",
    label: {
      en: "Add a feature",
      "zh-CN": "加一个功能",
      "zh-TW": "加一個功能",
      ja: "機能を追加",
      ko: "기능 추가",
      es: "Añadir una función",
      pt: "Adicionar um recurso",
      vi: "Thêm một tính năng",
      fr: "Ajouter une fonctionnalité",
      de: "Eine Funktion hinzufügen",
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
      ko: (t) =>
        `${t}\n\n앱의 현재 소스 코드를 읽은 다음, 제가 이어서 설명하는 기능을 추가해 주세요. 시작하기 전에 어떤 파일을 수정할지 알려 주세요.`,
      es: (t) =>
        `${t}\n\nLee el código fuente actual de la app y luego añade la función que te describa a continuación. Antes de empezar, dime qué archivos vas a tocar.`,
      pt: (t) =>
        `${t}\n\nLeia o código-fonte atual do app e depois adicione o recurso que eu descrever em seguida. Antes de começar, me diga quais arquivos você vai alterar.`,
      vi: (t) =>
        `${t}\n\nHãy đọc mã nguồn hiện tại của ứng dụng, rồi thêm tính năng tôi mô tả tiếp theo. Trước khi bắt đầu, hãy cho tôi biết bạn sẽ sửa những tệp nào.`,
      fr: (t) =>
        `${t}\n\nLisez le code source actuel de l'application, puis ajoutez la fonctionnalité que je décrirai ensuite. Avant de commencer, dites-moi quels fichiers vous allez modifier.`,
      de: (t) =>
        `${t}\n\nLesen Sie den aktuellen Quellcode der App und fügen Sie dann die Funktion hinzu, die ich als Nächstes beschreibe. Sagen Sie mir vor dem Start, welche Dateien Sie anfassen werden.`,
    },
  },
  {
    key: "airapp-debug",
    label: {
      en: "Debug a problem",
      "zh-CN": "排查一个问题",
      "zh-TW": "排查一個問題",
      ja: "不具合を調査",
      ko: "문제 원인 조사",
      es: "Depurar un problema",
      pt: "Depurar um problema",
      vi: "Gỡ lỗi một vấn đề",
      fr: "Déboguer un problème",
      de: "Ein Problem untersuchen",
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
      ko: (t) =>
        `${t}\n\n무엇이 잘못되고 있는지 설명할게요. 소스 코드를 읽고 실제 원인을 찾아서, 수정하기 전에 저에게 먼저 설명해 주세요.`,
      es: (t) =>
        `${t}\n\nTe describiré lo que va mal. Lee el código fuente, encuentra la causa real y explícamela antes de arreglar nada.`,
      pt: (t) =>
        `${t}\n\nVou descrever o que está dando errado. Leia o código-fonte, encontre a causa real e explique para mim antes de corrigir qualquer coisa.`,
      vi: (t) =>
        `${t}\n\nTôi sẽ mô tả điều gì đang trục trặc. Hãy đọc mã nguồn, tìm ra nguyên nhân thực sự và giải thích cho tôi trước khi sửa bất cứ thứ gì.`,
      fr: (t) =>
        `${t}\n\nJe vais décrire ce qui ne va pas. Lisez le code source, trouvez la cause réelle et expliquez-la-moi avant de corriger quoi que ce soit.`,
      de: (t) =>
        `${t}\n\nIch beschreibe, was schiefläuft. Lesen Sie den Quellcode, finden Sie die tatsächliche Ursache und erklären Sie sie mir, bevor Sie etwas beheben.`,
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
      ko: "이 폼의 페이지 새로 디자인하기",
      es: "Rediseñar la página de este formulario",
      pt: "Redesenhar a página deste formulário",
      vi: "Thiết kế lại trang của biểu mẫu này",
      fr: "Repenser la page de ce formulaire",
      de: "Die Seite dieses Formulars neu gestalten",
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
      ko: (t) =>
        `${t}\n\n먼저 이 폼의 현재 페이지 소스와 필드 바인딩을 읽어 주세요. 그런 다음 제가 이어서 설명하는 대로 페이지를 새로 디자인해 주세요. 레이아웃, 문구, 그룹화, 입력 힌트가 대상입니다. 제가 명시적으로 바꿔 달라고 하지 않는 한 기존 필드 바인딩은 모두 계속 동작해야 하며, 제출하기 전에 새 페이지를 보여 주세요.`,
      es: (t) =>
        `${t}\n\nLee primero el código fuente actual de la página del formulario y sus vínculos de campos. Luego rediseña la página como te describa a continuación: diseño, textos, agrupación y sugerencias de validación. Mantén funcionando todos los vínculos de campos existentes salvo que te pida expresamente cambiar alguno, y enséñame la nueva página antes de enviarla.`,
      pt: (t) =>
        `${t}\n\nLeia primeiro o código-fonte atual da página do formulário e os vínculos de campos. Depois redesenhe a página do jeito que eu descrever em seguida — layout, texto, agrupamento e dicas de validação. Mantenha todos os vínculos de campos existentes funcionando, a menos que eu peça explicitamente para mudar algum, e me mostre a nova página antes de enviá-la.`,
      vi: (t) =>
        `${t}\n\nTrước tiên hãy đọc mã nguồn trang hiện tại của biểu mẫu và các liên kết trường của nó. Sau đó thiết kế lại trang theo cách tôi mô tả tiếp theo — bố cục, câu chữ, cách nhóm và gợi ý kiểm tra hợp lệ. Giữ cho mọi liên kết trường hiện có tiếp tục hoạt động trừ khi tôi yêu cầu rõ ràng đổi một liên kết nào đó, và cho tôi xem trang mới trước khi gửi.`,
      fr: (t) =>
        `${t}\n\nLisez d'abord le code source actuel de la page du formulaire et ses liaisons de champs. Puis repensez la page comme je le décrirai ensuite — mise en page, formulation, regroupement et indications de validation. Gardez toutes les liaisons de champs existantes fonctionnelles sauf si je vous demande explicitement d'en changer une, et montrez-moi la nouvelle page avant de la soumettre.`,
      de: (t) =>
        `${t}\n\nLesen Sie zuerst den aktuellen Seitenquellcode des Formulars und seine Feldbindungen. Gestalten Sie die Seite dann so um, wie ich es als Nächstes beschreibe – Layout, Formulierungen, Gruppierung und Validierungshinweise. Lassen Sie alle vorhandenen Feldbindungen funktionsfähig, es sei denn, ich verlange ausdrücklich, eine zu ändern, und zeigen Sie mir die neue Seite, bevor Sie sie einreichen.`,
    },
  },
  {
    key: "form-bindings",
    label: {
      en: "Change which fields it collects",
      "zh-CN": "改这个表单收集哪些字段",
      "zh-TW": "改這個表單收集哪些欄位",
      ja: "収集するフィールドを変える",
      ko: "수집하는 필드 바꾸기",
      es: "Cambiar qué campos recoge",
      pt: "Mudar quais campos ele coleta",
      vi: "Đổi những trường mà nó thu thập",
      fr: "Changer les champs qu'il collecte",
      de: "Ändern, welche Felder es erfasst",
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
      ko: (t) =>
        `${t}\n\n이 폼이 현재 대상 베이스의 어떤 필드에 쓰고 있고, 베이스의 어떤 필드를 무시하고 있는지 먼저 보여 주세요. 그런 다음 제가 설명하는 대로 바인딩을 조정해 주세요. 추가한 필드에는 페이지에 대응하는 입력란이 있어야 하고, 제거한 필드의 입력란이 페이지에 주인 없이 남아 있으면 안 됩니다.`,
      es: (t) =>
        `${t}\n\nMuéstrame en qué campos de la Base de destino escribe actualmente este formulario y cuáles de los campos de la Base ignora. Luego ajusta los vínculos como te describa: un campo añadido necesita su entrada correspondiente en la página, y uno eliminado no debe dejar una entrada huérfana.`,
      pt: (t) =>
        `${t}\n\nMostre em quais campos da Base de destino este formulário grava hoje e quais campos da Base ele ignora. Depois ajuste os vínculos como eu descrever — um campo adicionado precisa de uma entrada correspondente na página, e um removido não pode deixar uma entrada órfã.`,
      vi: (t) =>
        `${t}\n\nHãy cho tôi xem biểu mẫu này hiện đang ghi vào những trường nào của cơ sở dữ liệu đích, và bỏ qua những trường nào. Sau đó điều chỉnh các liên kết theo mô tả của tôi — trường thêm vào cần có ô nhập tương ứng trên trang, còn trường bị bỏ đi thì không được để lại ô nhập mồ côi.`,
      fr: (t) =>
        `${t}\n\nMontrez-moi dans quels champs de la Base cible ce formulaire écrit actuellement, et quels champs de la Base il ignore. Puis ajustez les liaisons comme je le décrirai — un champ ajouté a besoin d'une saisie correspondante sur la page, et un champ retiré ne doit pas laisser de saisie orpheline.`,
      de: (t) =>
        `${t}\n\nZeigen Sie mir, in welche Felder der Ziel-Base dieses Formular derzeit schreibt und welche Felder der Base es ignoriert. Passen Sie die Bindungen dann so an, wie ich es beschreibe – ein hinzugefügtes Feld braucht ein passendes Eingabefeld auf der Seite, und ein entferntes darf kein verwaistes Eingabefeld zurücklassen.`,
    },
  },
  {
    key: "form-review-submissions",
    label: {
      en: "Review the pending submissions",
      "zh-CN": "审阅待处理的表单提交",
      "zh-TW": "審閱待處理的表單提交",
      ja: "保留中の送信を確認",
      ko: "대기 중인 제출 내용 검토",
      es: "Revisar los envíos pendientes",
      pt: "Revisar os envios pendentes",
      vi: "Xem xét các bài gửi đang chờ",
      fr: "Examiner les envois en attente",
      de: "Die ausstehenden Einsendungen prüfen",
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
      ko: (t) =>
        `${t}\n\n이 폼의 제출은 모두 직접 기록되지 않고 대기 중인 ChangeRequest로 들어옵니다. 아직 리뷰되지 않은 것들을 하나씩 살펴보고, 각각이 무엇을 추가하려는지 요약해 주세요. 스팸, 중복, 다른 항목과 모순되는 입력이 있으면 짚어 주세요. 제출마다 승인/거절 의견을 추천해 주세요. 결정은 제가 하니 병합하지 마세요.`,
      es: (t) =>
        `${t}\n\nCada envío de este formulario llega como una ChangeRequest pendiente en lugar de una escritura directa. Revisa las que aún esperan revisión, resume qué quiere añadir cada una y señala todo lo que parezca spam, un duplicado o un campo rellenado que contradiga al resto. Recomienda aceptar o rechazar cada envío: la decisión es mía, tú no fusiones.`,
      pt: (t) =>
        `${t}\n\nCada envio deste formulário chega como uma ChangeRequest pendente, e não como uma gravação direta. Passe pelos que ainda aguardam revisão, resuma o que cada um quer adicionar e sinalize tudo que parecer spam, duplicata ou um campo preenchido que contradiga o resto. Recomende aceitar ou rejeitar cada envio — a decisão é minha, você não mescla.`,
      vi: (t) =>
        `${t}\n\nMỗi bài gửi của biểu mẫu này đến dưới dạng một ChangeRequest đang chờ chứ không phải ghi trực tiếp. Hãy xem lần lượt những bài chưa được xem xét, tóm tắt từng bài muốn thêm gì, và đánh dấu bất cứ thứ gì trông như spam, bản trùng lặp hoặc một trường được điền mâu thuẫn với phần còn lại. Đề xuất chấp nhận hay từ chối cho từng bài gửi — tôi là người quyết định, bạn đừng hợp nhất.`,
      fr: (t) =>
        `${t}\n\nChaque envoi de ce formulaire arrive sous la forme d'une ChangeRequest en attente, et non d'une écriture directe. Passez en revue celles qui attendent encore d'être examinées, résumez ce que chacune veut ajouter et signalez tout ce qui ressemble à du spam, à un doublon ou à un champ rempli qui contredit le reste. Recommandez d'accepter ou de rejeter chaque envoi — c'est moi qui décide, vous ne fusionnez pas.`,
      de: (t) =>
        `${t}\n\nJede Einsendung dieses Formulars kommt als ausstehende ChangeRequest an und nicht als direkter Schreibzugriff. Gehen Sie die noch nicht geprüften durch, fassen Sie zusammen, was jede hinzufügen möchte, und markieren Sie alles, was nach Spam, einem Duplikat oder einem ausgefüllten Feld aussieht, das dem Rest widerspricht. Empfehlen Sie für jede Einsendung Annehmen oder Ablehnen – die Entscheidung treffe ich, Sie führen nichts zusammen.`,
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
      ko: "이 열의 값 정리하기",
      es: "Limpiar los valores de esta columna",
      pt: "Limpar os valores desta coluna",
      vi: "Làm sạch các giá trị của cột này",
      fr: "Nettoyer les valeurs de cette colonne",
      de: "Die Werte dieser Spalte bereinigen",
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
      ko: (t) =>
        `${t}\n\n모든 레코드에서 이 열을 읽고 표기를 통일해 주세요. 대소문자, 공백, 단위, 형식을 일관되게 맞추고 명백한 오타는 고쳐 주세요. 쓰기 전에 문제 유형별로 묶어서 어떤 변경을 할 계획인지 먼저 보여 주세요.`,
      es: (t) =>
        `${t}\n\nLee esta columna en todos los registros y normalízala: mayúsculas y minúsculas, espacios, unidades y formato coherentes, y erratas evidentes corregidas. Antes de escribir nada, enumera los cambios que piensas hacer, agrupados por tipo de problema.`,
      pt: (t) =>
        `${t}\n\nLeia esta coluna em todos os registros e normalize-a: maiúsculas e minúsculas, espaçamento, unidades e formatação consistentes, erros de digitação óbvios corrigidos. Antes de gravar qualquer coisa, liste as alterações que pretende fazer, agrupadas por tipo de problema.`,
      vi: (t) =>
        `${t}\n\nHãy đọc cột này trên tất cả bản ghi và chuẩn hóa nó: thống nhất chữ hoa/thường, khoảng trắng, đơn vị và định dạng, sửa các lỗi chính tả rõ ràng. Trước khi ghi bất cứ thứ gì, hãy liệt kê các thay đổi bạn định thực hiện, nhóm theo loại vấn đề.`,
      fr: (t) =>
        `${t}\n\nLisez cette colonne sur tous les enregistrements et normalisez-la : casse, espacement, unités et format cohérents, fautes de frappe évidentes corrigées. Avant d'écrire quoi que ce soit, listez les modifications que vous comptez faire, regroupées par type de problème.`,
      de: (t) =>
        `${t}\n\nLesen Sie diese Spalte über alle Datensätze hinweg und vereinheitlichen Sie sie: einheitliche Groß-/Kleinschreibung, Leerzeichen, Einheiten und Formatierung, offensichtliche Tippfehler korrigiert. Listen Sie vor dem Schreiben die geplanten Änderungen auf, gruppiert nach Art des Problems.`,
    },
  },
  {
    key: "field-fill-blanks",
    label: {
      en: "Fill in the blanks",
      "zh-CN": "补全这一列的空值",
      "zh-TW": "補全這一欄的空值",
      ja: "空欄を埋める",
      ko: "빈칸 채우기",
      es: "Rellenar los huecos",
      pt: "Preencher os vazios",
      vi: "Điền vào chỗ trống",
      fr: "Remplir les blancs",
      de: "Lücken füllen",
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
      ko: (t) =>
        `${t}\n\n이 필드가 비어 있는 레코드를 찾아 주세요. 각 레코드에 대해 그 레코드의 다른 필드로부터 값을 추론하고 근거를 알려 주세요. 정보가 충분하지 않은 레코드는 비워 두고 그렇게 말해 주세요. 추측하지 마세요.`,
      es: (t) =>
        `${t}\n\nBusca los registros en los que este campo esté vacío. Para cada uno, deduce un valor a partir de los OTROS campos del registro y dime de dónde lo sacaste. Si un registro no tiene información suficiente, déjalo vacío y dilo: no adivines.`,
      pt: (t) =>
        `${t}\n\nEncontre os registros em que este campo está vazio. Para cada um, deduza um valor a partir dos OUTROS campos do registro e me diga de onde tirou. Se um registro não tiver informação suficiente, deixe-o vazio e avise — não adivinhe.`,
      vi: (t) =>
        `${t}\n\nHãy tìm các bản ghi có trường này đang trống. Với mỗi bản ghi, hãy suy ra một giá trị từ các trường KHÁC của bản ghi đó và cho tôi biết bạn lấy từ đâu. Nếu một bản ghi không đủ thông tin, hãy để trống và nói rõ — đừng đoán.`,
      fr: (t) =>
        `${t}\n\nTrouvez les enregistrements dont ce champ est vide. Pour chacun, déduisez une valeur à partir des AUTRES champs de l'enregistrement et dites-moi d'où vous la tenez. Si un enregistrement n'a pas assez d'informations, laissez-le vide et signalez-le — ne devinez pas.`,
      de: (t) =>
        `${t}\n\nFinden Sie die Datensätze, bei denen dieses Feld leer ist. Leiten Sie für jeden einen Wert aus den ANDEREN Feldern des Datensatzes ab und sagen Sie mir, woher Sie ihn haben. Wenn ein Datensatz nicht genug Informationen enthält, lassen Sie ihn leer und sagen Sie das – raten Sie nicht.`,
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
      ko: "이 열의 잘못된 데이터 점검",
      es: "Auditar esta columna en busca de datos erróneos",
      pt: "Auditar esta coluna em busca de dados ruins",
      vi: "Rà soát cột này để tìm dữ liệu xấu",
      fr: "Auditer cette colonne à la recherche de données erronées",
      de: "Diese Spalte auf fehlerhafte Daten prüfen",
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
      ko: (t) =>
        `${t}\n\n이 열을 살펴보고 이상해 보이는 것을 보고해 주세요. 필드의 유형이나 의도에 맞지 않는 값, 이상치, 하나의 값이어야 하는데 달리 적힌 중복, 자리 표시자처럼 보이는 내용이 대상입니다. 읽기 전용입니다. 먼저 보고하고 아무것도 바꾸지 마세요.`,
      es: (t) =>
        `${t}\n\nRevisa esta columna e infórmame de lo que parezca incorrecto: valores que no encajan con el tipo o la finalidad del campo, valores atípicos, duplicados que deberían ser un solo valor y cualquier cosa que parezca un marcador de posición. Solo lectura: informa primero y no cambies nada.`,
      pt: (t) =>
        `${t}\n\nPercorra esta coluna e relate o que parecer errado: valores que não combinam com o tipo ou a intenção do campo, valores atípicos, duplicatas que deveriam ser um único valor e qualquer coisa que pareça um marcador de posição. Somente leitura — relate primeiro e não altere nada.`,
      vi: (t) =>
        `${t}\n\nHãy xem qua cột này và báo cáo những gì trông sai: giá trị không khớp với kiểu hoặc mục đích của trường, giá trị ngoại lai, các bản trùng lẽ ra chỉ là một giá trị, và bất cứ thứ gì trông như giá trị giữ chỗ. Chỉ đọc — báo cáo trước, đừng thay đổi gì.`,
      fr: (t) =>
        `${t}\n\nParcourez cette colonne et signalez ce qui semble erroné : valeurs qui ne correspondent pas au type ou à l'objet du champ, valeurs aberrantes, doublons qui devraient être une seule valeur et tout ce qui ressemble à un texte provisoire. Lecture seule — rapportez d'abord, ne modifiez rien.`,
      de: (t) =>
        `${t}\n\nGehen Sie diese Spalte durch und melden Sie, was falsch aussieht: Werte, die nicht zu Typ oder Zweck des Feldes passen, Ausreißer, Duplikate, die ein einziger Wert sein sollten, und alles, was wie ein Platzhalter wirkt. Nur lesend – erst berichten, nichts ändern.`,
    },
  },
  {
    key: "field-redesign",
    label: {
      en: "Change this column's type or options",
      "zh-CN": "改这一列的类型或选项",
      "zh-TW": "改這一欄的型別或選項",
      ja: "この列の型・選択肢を変える",
      ko: "이 열의 유형·옵션 바꾸기",
      es: "Cambiar el tipo o las opciones de esta columna",
      pt: "Mudar o tipo ou as opções desta coluna",
      vi: "Đổi kiểu hoặc tùy chọn của cột này",
      fr: "Changer le type ou les options de cette colonne",
      de: "Typ oder Optionen dieser Spalte ändern",
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
      ko: (t) =>
        `${t}\n\n이 필드의 정의(유형, 옵션, 필수 여부)를 바꾸고 싶어요. 이미 들어 있는 값을 읽고, 무엇이 손실되거나 변환이 필요한지 알려 주세요. 스키마를 변경하기 전에 제 확인을 기다려 주세요.`,
      es: (t) =>
        `${t}\n\nQuiero cambiar cómo está definido este campo: su tipo, sus opciones o si es obligatorio. Lee los valores que ya contiene, dime qué se perdería o habría que convertir y espera mi visto bueno antes de cambiar el esquema.`,
      pt: (t) =>
        `${t}\n\nQuero mudar como este campo é definido — seu tipo, suas opções ou se é obrigatório. Leia os valores que já estão nele, me diga o que seria perdido ou precisaria ser convertido e espere o meu aval antes de alterar o esquema.`,
      vi: (t) =>
        `${t}\n\nTôi muốn thay đổi cách định nghĩa trường này — kiểu, các tùy chọn hoặc việc có bắt buộc hay không. Hãy đọc các giá trị đang có trong đó, cho tôi biết điều gì sẽ mất hoặc cần chuyển đổi, và chờ tôi đồng ý trước khi thay đổi cấu trúc.`,
      fr: (t) =>
        `${t}\n\nJe veux changer la définition de ce champ — son type, ses options ou son caractère obligatoire. Lisez les valeurs qu'il contient déjà, dites-moi ce qui serait perdu ou devrait être converti, et attendez mon feu vert avant de modifier le schéma.`,
      de: (t) =>
        `${t}\n\nIch möchte ändern, wie dieses Feld definiert ist – seinen Typ, seine Optionen oder ob es ein Pflichtfeld ist. Lesen Sie die bereits enthaltenen Werte, sagen Sie mir, was verloren ginge oder konvertiert werden müsste, und warten Sie auf mein Okay, bevor Sie das Schema ändern.`,
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
      ko: "이 값 다시 쓰기",
      es: "Reescribir este valor",
      pt: "Reescrever este valor",
      vi: "Viết lại giá trị này",
      fr: "Réécrire cette valeur",
      de: "Diesen Wert umschreiben",
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
      ko: (t) =>
        `${t}\n\n현재 값을 읽은 다음, 제가 이어서 설명하는 대로 다시 써 주세요. 제출하기 전에 이전 값과 새 값을 나란히 보여 주시고, 제가 요청하지 않는 한 의미는 바꾸지 마세요.`,
      es: (t) =>
        `${t}\n\nLee el valor actual y luego reescríbelo como te describa a continuación. Enséñame el valor antiguo y el nuevo lado a lado antes de enviarlo y no cambies el significado salvo que te lo haya pedido.`,
      pt: (t) =>
        `${t}\n\nLeia o valor atual e depois reescreva-o do jeito que eu descrever em seguida. Mostre o valor antigo e o novo lado a lado antes de enviar e não mude o significado, a menos que eu tenha pedido.`,
      vi: (t) =>
        `${t}\n\nHãy đọc giá trị hiện tại, rồi viết lại theo cách tôi mô tả tiếp theo. Trước khi gửi, hãy cho tôi xem giá trị cũ và mới cạnh nhau, và đừng thay đổi ý nghĩa trừ khi tôi yêu cầu.`,
      fr: (t) =>
        `${t}\n\nLisez la valeur actuelle, puis réécrivez-la comme je le décrirai ensuite. Montrez-moi l'ancienne et la nouvelle valeur côte à côte avant de soumettre, et ne changez pas le sens sauf si je vous l'ai demandé.`,
      de: (t) =>
        `${t}\n\nLesen Sie den aktuellen Wert und schreiben Sie ihn dann so um, wie ich es als Nächstes beschreibe. Zeigen Sie mir vor dem Einreichen den alten und den neuen Wert nebeneinander und ändern Sie die Bedeutung nicht, es sei denn, ich habe darum gebeten.`,
    },
  },
  {
    key: "cell-derive",
    label: {
      en: "Fill it in from the other fields",
      "zh-CN": "根据其它字段推出这一格",
      "zh-TW": "根據其他欄位推出這一格",
      ja: "他のフィールドから埋める",
      ko: "다른 필드로 채우기",
      es: "Rellenarlo a partir de los otros campos",
      pt: "Preencher a partir dos outros campos",
      vi: "Điền từ các trường khác",
      fr: "La remplir à partir des autres champs",
      de: "Aus den anderen Feldern ableiten",
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
      ko: (t) =>
        `${t}\n\n이 레코드의 다른 필드로부터 이 값이 무엇이어야 하는지 추론해 주세요. 어떤 필드를 썼고 어떻게 도출했는지 알려 주세요. 레코드에 정보가 충분하지 않으면 그렇게 말하고 값은 그대로 두세요. 추측하지 마세요.`,
      es: (t) =>
        `${t}\n\nDeduce cuál debería ser este valor a partir de los OTROS campos del registro. Dime qué campos usaste y cómo llegaste a él. Si el registro no tiene información suficiente, dilo y déjalo como está: no adivines.`,
      pt: (t) =>
        `${t}\n\nDeduza qual deve ser este valor a partir dos OUTROS campos do registro. Diga quais campos usou e como chegou a ele. Se o registro não tiver informação suficiente, avise e deixe como está — não adivinhe.`,
      vi: (t) =>
        `${t}\n\nHãy suy ra giá trị này nên là gì từ các trường KHÁC của bản ghi. Cho tôi biết bạn đã dùng những trường nào và suy ra bằng cách nào. Nếu bản ghi không đủ thông tin, hãy nói rõ và giữ nguyên — đừng đoán.`,
      fr: (t) =>
        `${t}\n\nDéduisez ce que devrait être cette valeur à partir des AUTRES champs de l'enregistrement. Dites-moi quels champs vous avez utilisés et comment vous y êtes arrivé. Si l'enregistrement ne contient pas assez d'informations, dites-le et laissez la valeur telle quelle — ne devinez pas.`,
      de: (t) =>
        `${t}\n\nLeiten Sie aus den ANDEREN Feldern des Datensatzes ab, was dieser Wert sein sollte. Sagen Sie mir, welche Felder Sie verwendet haben und wie Sie darauf gekommen sind. Wenn der Datensatz nicht genug Informationen enthält, sagen Sie das und lassen Sie den Wert, wie er ist – raten Sie nicht.`,
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
      ko: "이 값 설명",
      es: "Explicar este valor",
      pt: "Explicar este valor",
      vi: "Giải thích giá trị này",
      fr: "Expliquer cette valeur",
      de: "Diesen Wert erklären",
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
      ko: (t) =>
        `${t}\n\n이 값이 무엇을 의미하는지, 마지막으로 언제 누가 바꿨는지, 그리고 레코드의 나머지 내용 및 비슷한 레코드의 같은 필드와 일관되는지 알려 주세요. 읽기 전용입니다. 아무것도 바꾸지 마세요.`,
      es: (t) =>
        `${t}\n\nDime qué significa este valor, cuándo y quién lo cambió por última vez, y si es coherente con el resto del registro y con el mismo campo en registros comparables. Solo lectura: no cambies nada.`,
      pt: (t) =>
        `${t}\n\nMe diga o que este valor significa, quando e por quem foi alterado pela última vez e se ele é coerente com o resto do registro e com o mesmo campo em registros comparáveis. Somente leitura — não altere nada.`,
      vi: (t) =>
        `${t}\n\nHãy cho tôi biết giá trị này có nghĩa là gì, lần gần nhất ai đã đổi và khi nào, và nó có nhất quán với phần còn lại của bản ghi cũng như với cùng trường ở các bản ghi tương tự không. Chỉ đọc — đừng thay đổi gì.`,
      fr: (t) =>
        `${t}\n\nDites-moi ce que signifie cette valeur, quand et par qui elle a été modifiée pour la dernière fois, et si elle est cohérente avec le reste de l'enregistrement et avec le même champ sur des enregistrements comparables. Lecture seule — ne modifiez rien.`,
      de: (t) =>
        `${t}\n\nSagen Sie mir, was dieser Wert bedeutet, wann und von wem er zuletzt geändert wurde und ob er zum Rest des Datensatzes und zum selben Feld bei vergleichbaren Datensätzen passt. Nur lesend – ändern Sie nichts.`,
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
      ko: "이 레코드 채우기",
      es: "Completar este registro",
      pt: "Completar este registro",
      vi: "Hoàn thiện bản ghi này",
      fr: "Compléter cet enregistrement",
      de: "Diesen Datensatz vervollständigen",
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
      ko: (t) =>
        `${t}\n\n이 레코드의 모든 필드와 베이스의 필드 구성을 읽어 주세요. 레코드에 이미 있는 내용과 제가 이어서 드리는 정보를 바탕으로 빠졌거나 분명히 덜 채워진 부분을 채워 주세요. 새로 넣은 값마다 출처를 알려 주시고, 추측해야 하는 것은 비워 두세요.`,
      es: (t) =>
        `${t}\n\nLee todos los campos de este registro y el esquema de campos de la Base. Rellena lo que falte o esté claramente incompleto, usando el contenido existente del registro y lo que te dé a continuación. Indica de dónde salió cada valor nuevo y deja vacío todo lo que tuvieras que adivinar.`,
      pt: (t) =>
        `${t}\n\nLeia todos os campos deste registro e o esquema de campos da Base. Preencha o que estiver faltando ou claramente incompleto, usando o conteúdo já existente no registro e o que eu passar em seguida. Diga de onde veio cada valor novo e deixe vazio tudo o que você teria de adivinhar.`,
      vi: (t) =>
        `${t}\n\nHãy đọc mọi trường của bản ghi này và cấu trúc trường của cơ sở dữ liệu. Điền những phần còn thiếu hoặc rõ ràng chưa đầy đủ, dựa trên nội dung sẵn có của bản ghi và những gì tôi đưa tiếp theo. Cho biết mỗi giá trị mới lấy từ đâu, và để trống mọi thứ mà bạn buộc phải đoán.`,
      fr: (t) =>
        `${t}\n\nLisez tous les champs de cet enregistrement et le schéma des champs de la Base. Renseignez ce qui manque ou est clairement incomplet, en vous appuyant sur le contenu existant de l'enregistrement et sur ce que je vous donnerai ensuite. Indiquez d'où vient chaque nouvelle valeur et laissez vide tout ce que vous devriez deviner.`,
      de: (t) =>
        `${t}\n\nLesen Sie alle Felder dieses Datensatzes und das Feldschema der Base. Ergänzen Sie, was fehlt oder offensichtlich unvollständig ist, anhand des vorhandenen Inhalts des Datensatzes und dessen, was ich Ihnen als Nächstes gebe. Nennen Sie zu jedem neuen Wert die Quelle und lassen Sie alles leer, was Sie raten müssten.`,
    },
  },
  {
    key: "record-rewrite",
    label: {
      en: "Rewrite this record's content",
      "zh-CN": "改写这条记录的内容",
      "zh-TW": "改寫這筆記錄的內容",
      ja: "このレコードの内容を書き直す",
      ko: "이 레코드의 내용 다시 쓰기",
      es: "Reescribir el contenido de este registro",
      pt: "Reescrever o conteúdo deste registro",
      vi: "Viết lại nội dung bản ghi này",
      fr: "Réécrire le contenu de cet enregistrement",
      de: "Den Inhalt dieses Datensatzes umschreiben",
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
      ko: (t) =>
        `${t}\n\n이 레코드의 텍스트 필드를 제가 이어서 설명하는 대로(어조, 길이, 구조) 다시 써 주세요. 사실 관계는 그대로 유지하세요. 사실이 틀렸다고 생각되면 몰래 고치지 말고 알려 주세요.`,
      es: (t) =>
        `${t}\n\nReescribe los campos de texto de este registro como te describa a continuación: tono, longitud o estructura. Mantén los hechos idénticos; si crees que algún dato es incorrecto, dilo en lugar de cambiarlo en silencio.`,
      pt: (t) =>
        `${t}\n\nReescreva os campos de texto deste registro do jeito que eu descrever em seguida — tom, tamanho ou estrutura. Mantenha os fatos idênticos; se achar que algum fato está errado, diga isso em vez de alterá-lo em silêncio.`,
      vi: (t) =>
        `${t}\n\nHãy viết lại các trường văn bản của bản ghi này theo cách tôi mô tả tiếp theo — giọng điệu, độ dài hoặc cấu trúc. Giữ nguyên các dữ kiện; nếu bạn nghĩ một dữ kiện sai, hãy nói ra thay vì âm thầm sửa.`,
      fr: (t) =>
        `${t}\n\nRéécrivez les champs texte de cet enregistrement comme je le décrirai ensuite — ton, longueur ou structure. Conservez les faits à l'identique ; si vous pensez qu'un fait est erroné, dites-le au lieu de le changer discrètement.`,
      de: (t) =>
        `${t}\n\nSchreiben Sie die Textfelder dieses Datensatzes so um, wie ich es als Nächstes beschreibe – Ton, Länge oder Struktur. Die Fakten müssen identisch bleiben; wenn Sie glauben, dass ein Fakt falsch ist, sagen Sie es, statt ihn stillschweigend zu ändern.`,
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
      ko: "이 레코드 설명 듣기",
      es: "Explicarme este registro",
      pt: "Explicar este registro para mim",
      vi: "Giải thích bản ghi này cho tôi",
      fr: "M'expliquer cet enregistrement",
      de: "Mir diesen Datensatz erklären",
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
      ko: (t) =>
        `${t}\n\n이 레코드와 변경 이력을 읽고 쉬운 말로 설명해 주세요. 무엇을 나타내는지, 가장 최근에 무엇이 왜 바뀌었는지, 테이블의 나머지와 맞지 않는 부분이 있는지 알려 주세요. 읽기 전용이므로 수정하지 마세요.`,
      es: (t) =>
        `${t}\n\nLee este registro y su historial de cambios y luego explícamelo con palabras sencillas: qué representa, qué cambió más recientemente y por qué, y cualquier cosa que no encaje con el resto de la tabla. Solo lectura: no lo modifiques.`,
      pt: (t) =>
        `${t}\n\nLeia este registro e o histórico de alterações dele e depois explique para mim em linguagem simples: o que ele representa, o que mudou mais recentemente e por quê, e qualquer coisa incoerente com o resto da tabela. Somente leitura — não o modifique.`,
      vi: (t) =>
        `${t}\n\nHãy đọc bản ghi này và lịch sử thay đổi của nó, rồi giải thích cho tôi bằng lời dễ hiểu: nó đại diện cho điều gì, gần đây thay đổi gì và vì sao, và có điều gì không nhất quán với phần còn lại của bảng. Chỉ đọc — đừng sửa nó.`,
      fr: (t) =>
        `${t}\n\nLisez cet enregistrement et son historique de modifications, puis expliquez-le-moi en langage simple : ce qu'il représente, ce qui a changé le plus récemment et pourquoi, et tout ce qui est incohérent avec le reste de la table. Lecture seule — ne le modifiez pas.`,
      de: (t) =>
        `${t}\n\nLesen Sie diesen Datensatz und seinen Änderungsverlauf und erklären Sie ihn mir dann in einfachen Worten: was er darstellt, was sich zuletzt und warum geändert hat und was nicht zum Rest der Tabelle passt. Nur lesend – ändern Sie ihn nicht.`,
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
 *
 * **The target line is not optional.** A prompt that never names the node is a
 * prompt the agent has to guess the target of — it is the one part of a prompt
 * that is load-bearing rather than stylistic. Curated prompts get it for free
 * because every hand-written body starts with `${t}`; a custom body is author
 * text, and an author who simply did not know about `{target}` used to ship a
 * prompt with no target at all, silently. So the placeholder now controls
 * PLACEMENT, not presence: write `{target}` and it goes exactly where you put
 * it, omit it and the target line is prepended as its own paragraph. Decided
 * per locale, because a half-translated body (placeholder in `zh-CN`, forgotten
 * in `en`) must not lose the target on the locale that forgot it.
 */
const customPromptDefToPromptDef = (custom: CustomPromptDef): PromptDef => {
  const label = Object.fromEntries(
    CORE_LOCALES.map((locale) => [locale, iStringParse(custom.label, locale)]),
  ) as Record<CoreLocale, string>;
  const body = Object.fromEntries(
    CORE_LOCALES.map((locale) => {
      const template = iStringParse(custom.body, locale);
      const placed = template.includes("{target}");
      return [
        locale,
        (target: string) =>
          placed ? template.replaceAll("{target}", target) : `${target}\n\n${template}`,
      ];
    }),
  ) as Record<CoreLocale, (target: string) => string>;
  return { key: custom.key, intent: custom.intent, label, body };
};

/**
 * Read this node's custom `agentPrompts` (written by `busabase-cli nodes
 * set-agent-prompts` or a direct API call) and, when present and valid, return
 * them as `PromptDef`s appended after `SCENARIOS_BY_TYPE[nodeType]` for the
 * whole-node dialog (§7.3).
 *
 * Returns `undefined` — "fall through to the node type's default scenarios" —
 * when the key is absent, an empty array, or fails `.safeParse`. That last
 * case is the safety net §10's failure matrix requires: corrupt jsonb (a
 * manual edit, or a write that bypassed the CLI's own validation) must never
 * crash the dialog or render garbage; it simply leaves the built-in scenarios
 * as the complete scenario tier.
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
  source: NodePromptSource = tier === "scenario" ? "built-in-scenario" : "capability",
): NodePrompt => {
  const intent = prompt.intent ?? "change";
  const footer =
    intent === "read-only"
      ? REPLY_LANGUAGE[locale]
      : `${MERGE_POLICY[locale]} ${REPLY_LANGUAGE[locale]}`;

  return {
    key: source === "custom-scenario" ? `custom:${prompt.key}` : prompt.key,
    tier,
    source,
    ...(source === "custom-scenario" ? { customKey: prompt.key } : {}),
    label: prompt.label[locale],
    group,
    body: `${prompt.body[locale](target)}\n\n${footer}`,
  };
};

/**
 * Just the "which node am I talking about" sentence, without a prompt around it.
 *
 * Exported for the side panel's context chip: when someone types their own
 * message to an agent with a node open, the chip sends this same line. Sharing
 * it with the prompts (rather than writing a second, similar sentence in the
 * agents domain) is what keeps an agent from having to recognise two different
 * phrasings of the same fact.
 */
export const renderNodeTargetLine = (context: NodePromptContext, locale: CoreLocale): string => {
  const definition = getNodeType(context.nodeType);
  return TARGET_LINE[locale](context, definition?.label ?? context.nodeType);
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
  // Custom scenario prompts (§7.3) are authored per NODE and are appended after
  // the whole-node dialog's built-in scenario tier. A field/record/cell-scoped dialog
  // always uses its own narrower, scope-specific set above, same as before this
  // feature existed. A node's custom prompts have no opinion about "just this
  // column" or "just this record".
  const builtInScenarioDefs =
    scope.kind === "node"
      ? (SCENARIOS_BY_TYPE[context.nodeType] ?? [])
      : (SCENARIOS_BY_SCOPE[scope.kind] ?? SCENARIOS_BY_TYPE[context.nodeType] ?? []);
  const customScenarioDefs =
    scope.kind === "node" ? (readCustomAgentPrompts(context.customPrompts) ?? []) : [];

  const scenarios = [
    ...builtInScenarioDefs.map((scenario) =>
      buildCuratedPrompt(scenario, locale, target, "scenario", groupLabels.content),
    ),
    ...customScenarioDefs.map((scenario) =>
      buildCuratedPrompt(
        scenario,
        locale,
        target,
        "scenario",
        groupLabels.content,
        "custom-scenario",
      ),
    ),
  ];

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
        source: "capability",
        label: opLabel,
        group: groupLabels[group],
        body: `${CAPABILITY_TEMPLATE[locale](target, opLabel)}\n\n${MERGE_POLICY[locale]} ${
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
  ko: (c) => {
    const where = c.parentNodeId
      ? `폴더 "${c.parentName ?? c.parentNodeId}" (nodeId: ${c.parentNodeId}) 안`
      : "루트";
    const space = c.spaceId
      ? `스페이스 "${c.spaceName ?? c.spaceId}" (spaceId: ${c.spaceId})의 `
      : "";
    return `대상: Busabase ${space}${where}에 새로 만듭니다.`;
  },
  es: (c) => {
    const where = c.parentNodeId
      ? `dentro de la carpeta «${c.parentName ?? c.parentNodeId}» (nodeId: ${c.parentNodeId})`
      : "en la raíz";
    const space = c.spaceId
      ? ` del espacio «${c.spaceName ?? c.spaceId}» (spaceId: ${c.spaceId})`
      : "";
    return `Destino: crear algo nuevo en Busabase, ${where}${space}.`;
  },
  pt: (c) => {
    const where = c.parentNodeId
      ? `dentro da pasta “${c.parentName ?? c.parentNodeId}” (nodeId: ${c.parentNodeId})`
      : "na raiz";
    const space = c.spaceId
      ? ` do espaço “${c.spaceName ?? c.spaceId}” (spaceId: ${c.spaceId})`
      : "";
    return `Alvo: criar algo novo no Busabase, ${where}${space}.`;
  },
  vi: (c) => {
    const where = c.parentNodeId
      ? `bên trong thư mục “${c.parentName ?? c.parentNodeId}” (nodeId: ${c.parentNodeId})`
      : "ở thư mục gốc";
    const space = c.spaceId
      ? ` của không gian “${c.spaceName ?? c.spaceId}” (spaceId: ${c.spaceId})`
      : "";
    return `Đối tượng: tạo một mục mới trong Busabase, ${where}${space}.`;
  },
  fr: (c) => {
    const where = c.parentNodeId
      ? `dans le dossier « ${c.parentName ?? c.parentNodeId} » (nodeId: ${c.parentNodeId})`
      : "à la racine";
    const space = c.spaceId
      ? ` de l'espace « ${c.spaceName ?? c.spaceId} » (spaceId: ${c.spaceId})`
      : "";
    return `Cible : créer un nouvel élément dans Busabase, ${where}${space}.`;
  },
  de: (c) => {
    const where = c.parentNodeId
      ? `im Ordner „${c.parentName ?? c.parentNodeId}“ (nodeId: ${c.parentNodeId})`
      : "im Stammverzeichnis";
    const space = c.spaceId
      ? ` des Space „${c.spaceName ?? c.spaceId}“ (spaceId: ${c.spaceId})`
      : "";
    return `Ziel: etwas Neues in Busabase erstellen, ${where}${space}.`;
  },
};

const CREATE_GROUP_LABEL: Record<CoreLocale, string> = {
  en: "Create",
  "zh-CN": "新建",
  "zh-TW": "新建",
  ja: "作成",
  ko: "생성",
  es: "Crear",
  pt: "Criar",
  vi: "Tạo",
  fr: "Créer",
  de: "Erstellen",
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
  ko: (typeLabel) => `${typeLabel} 생성`,
  es: (typeLabel) => `Crear ${typeLabel}`,
  pt: (typeLabel) => `Criar ${typeLabel}`,
  vi: (typeLabel) => `Tạo ${typeLabel}`,
  fr: (typeLabel) => `Créer ${typeLabel}`,
  de: (typeLabel) => `${typeLabel} erstellen`,
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
      ko: "무언가를 관리할 베이스",
      es: "Una Base para registrar algo",
      pt: "Uma Base para acompanhar algo",
      vi: "Một cơ sở dữ liệu để theo dõi việc gì đó",
      fr: "Une Base pour suivre quelque chose",
      de: "Eine Base, um etwas zu erfassen",
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
      ko: (t) =>
        `${t}\n\n무언가를 관리할 베이스가 필요해요. 내용은 이어서 설명할게요. 먼저 필드 구성(필드 이름, 유형, 각 필드가 필요한 이유)을 제안하고, 제가 제안을 승인한 뒤에만 만들어 주세요.`,
      es: (t) =>
        `${t}\n\nQuiero una Base para registrar algo; te lo describiré a continuación. Propón primero el esquema de campos (nombres de campo, tipos y el porqué de cada uno) y créala solo después de que yo apruebe la propuesta.`,
      pt: (t) =>
        `${t}\n\nQuero uma Base para acompanhar algo — vou descrever em seguida. Proponha primeiro o esquema de campos (nomes de campo, tipos e o motivo de cada um) e crie-a somente depois que eu aprovar a proposta.`,
      vi: (t) =>
        `${t}\n\nTôi muốn có một cơ sở dữ liệu để theo dõi việc gì đó — tôi sẽ mô tả tiếp theo. Trước tiên hãy đề xuất cấu trúc trường (tên trường, kiểu và lý do cho từng trường), và chỉ tạo sau khi tôi duyệt đề xuất.`,
      fr: (t) =>
        `${t}\n\nJe veux une Base pour suivre quelque chose — je la décrirai ensuite. Proposez d'abord le schéma des champs (noms des champs, types et raison d'être de chacun), et ne la créez qu'après que j'aurai approuvé la proposition.`,
      de: (t) =>
        `${t}\n\nIch möchte eine Base, um etwas zu erfassen – ich beschreibe es als Nächstes. Schlagen Sie zuerst das Feldschema vor (Feldnamen, Typen und wozu jedes Feld dient) und legen Sie sie erst an, nachdem ich den Vorschlag genehmigt habe.`,
    },
  },
  {
    key: "create-base-from-data",
    label: {
      en: "Turn this data into a Base",
      "zh-CN": "把这份数据建成一个表",
      "zh-TW": "把這份資料建成一個表",
      ja: "このデータを Base にする",
      ko: "이 데이터를 베이스로 만들기",
      es: "Convertir estos datos en una Base",
      pt: "Transformar estes dados em uma Base",
      vi: "Biến dữ liệu này thành một cơ sở dữ liệu",
      fr: "Transformer ces données en Base",
      de: "Diese Daten in eine Base verwandeln",
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
      ko: (t) =>
        `${t}\n\n표(CSV, 스프레드시트 또는 목록)를 붙여 넣을게요. 거기서 필드 구성을 추론하고, 구성과 읽은 행 수를 보여 준 다음 베이스를 만들어 행을 가져와 주세요.`,
      es: (t) =>
        `${t}\n\nPegaré una tabla (CSV, hoja de cálculo o una lista). Deduce de ella un esquema de campos, enséñame el esquema y cuántas filas leíste, y luego crea la Base e importa las filas.`,
      pt: (t) =>
        `${t}\n\nVou colar uma tabela (CSV, planilha ou uma lista). Deduza um esquema de campos a partir dela, me mostre o esquema e quantas linhas você leu e depois crie a Base e importe as linhas.`,
      vi: (t) =>
        `${t}\n\nTôi sẽ dán một bảng (CSV, bảng tính hoặc một danh sách). Hãy suy ra cấu trúc trường từ đó, cho tôi xem cấu trúc và số hàng bạn đã đọc, rồi tạo cơ sở dữ liệu và nhập các hàng vào.`,
      fr: (t) =>
        `${t}\n\nJe vais coller un tableau (CSV, feuille de calcul ou liste). Déduisez-en un schéma de champs, montrez-moi le schéma et le nombre de lignes lues, puis créez la Base et importez les lignes.`,
      de: (t) =>
        `${t}\n\nIch füge eine Tabelle ein (CSV, Tabellenkalkulation oder eine Liste). Leiten Sie daraus ein Feldschema ab, zeigen Sie mir das Schema und wie viele Zeilen Sie gelesen haben, und legen Sie dann die Base an und importieren Sie die Zeilen.`,
    },
  },
  {
    key: "create-doc-draft",
    label: {
      en: "A Doc, and draft it for me",
      "zh-CN": "建文档并帮我起草",
      "zh-TW": "建文件並幫我起草",
      ja: "Doc を作って下書きする",
      ko: "문서를 만들고 초안 쓰기",
      es: "Crear un Doc y que lo redactes por mí",
      pt: "Criar um Doc e redigi-lo para mim",
      vi: "Tạo tài liệu và soạn nháp giúp tôi",
      fr: "Un Doc, rédigé pour moi",
      de: "Ein Doc, das Sie für mich entwerfen",
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
      ko: (t) =>
        `${t}\n\n문서를 만들고, 제가 이어서 설명하는 내용으로 첫 번째 초안을 써 주세요. 전체 초안을 쓰기 전에 개요를 먼저 보여 주세요.`,
      es: (t) =>
        `${t}\n\nCrea un Doc y redacta su primera versión a partir de lo que te describa a continuación. Dame un índice antes de escribir el borrador completo.`,
      pt: (t) =>
        `${t}\n\nCrie um Doc e redija a primeira versão dele com base no que eu descrever em seguida. Me dê um esboço antes de escrever o rascunho completo.`,
      vi: (t) =>
        `${t}\n\nHãy tạo một tài liệu và soạn bản đầu tiên dựa trên những gì tôi mô tả tiếp theo. Cho tôi xem dàn ý trước khi viết bản nháp đầy đủ.`,
      fr: (t) =>
        `${t}\n\nCréez un Doc et rédigez-en la première version d'après ce que je décrirai ensuite. Donnez-moi un plan avant d'écrire le brouillon complet.`,
      de: (t) =>
        `${t}\n\nErstellen Sie ein Doc und entwerfen Sie die erste Fassung anhand dessen, was ich als Nächstes beschreibe. Geben Sie mir eine Gliederung, bevor Sie den vollständigen Entwurf schreiben.`,
    },
  },
  {
    key: "create-folder-structure",
    label: {
      en: "A whole folder structure",
      "zh-CN": "建一套文件夹结构",
      "zh-TW": "建一套資料夾結構",
      ja: "フォルダ構成をまとめて作る",
      ko: "폴더 구조 통째로 만들기",
      es: "Toda una estructura de carpetas",
      pt: "Toda uma estrutura de pastas",
      vi: "Cả một cấu trúc thư mục",
      fr: "Toute une arborescence de dossiers",
      de: "Eine ganze Ordnerstruktur",
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
      ko: (t) =>
        `${t}\n\n이 영역을 어떻게 정리하고 싶은지 설명할게요. 폴더와 각 폴더에 들어갈 내용을 포함한 전체 트리를 한눈에 읽을 수 있는 계획으로 제안하고, 제가 승인하면 만들어 주세요.`,
      es: (t) =>
        `${t}\n\nTe describiré cómo quiero organizar esta zona. Propón el árbol completo (las carpetas y qué va en cada una) como un plan que pueda leer de una vez y créalo cuando yo lo apruebe.`,
      pt: (t) =>
        `${t}\n\nVou descrever como quero organizar esta área. Proponha a árvore inteira — as pastas e o que vai em cada uma — como um plano que eu possa ler de uma vez e crie-a depois que eu aprovar.`,
      vi: (t) =>
        `${t}\n\nTôi sẽ mô tả cách tôi muốn tổ chức khu vực này. Hãy đề xuất toàn bộ cây thư mục — các thư mục và nội dung của từng thư mục — dưới dạng một kế hoạch tôi đọc được một lượt, rồi tạo sau khi tôi duyệt.`,
      fr: (t) =>
        `${t}\n\nJe vais décrire comment je veux organiser cet espace. Proposez l'arborescence complète — les dossiers et ce que contient chacun — sous forme d'un plan que je puisse lire d'un coup, puis créez-la une fois que je l'aurai approuvée.`,
      de: (t) =>
        `${t}\n\nIch beschreibe, wie ich diesen Bereich organisieren möchte. Schlagen Sie den ganzen Baum vor – die Ordner und was in jeden gehört – als Plan, den ich in einem Zug lesen kann, und legen Sie ihn an, sobald ich zugestimmt habe.`,
    },
  },
  {
    key: "create-from-template",
    label: {
      en: "Set one up from a template",
      "zh-CN": "照模板装一套",
      "zh-TW": "照範本裝一套",
      ja: "テンプレートから用意する",
      ko: "템플릿으로 세팅하기",
      es: "Montar uno a partir de una plantilla",
      pt: "Montar um a partir de um modelo",
      vi: "Dựng một bộ từ mẫu có sẵn",
      fr: "En installer un à partir d'un modèle",
      de: "Eines aus einer Vorlage einrichten",
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
      ko: (t) =>
        `${t}\n\n템플릿 센터에 무엇이 있는지 살펴보고, 제가 이어서 설명하는 내용에 맞는 것을 추천해 주세요. 설치하기 전에 무엇이 만들어지는지 알려 주세요.`,
      es: (t) =>
        `${t}\n\nMira qué hay disponible en el centro de plantillas, recomiéndame la que mejor encaje con lo que te describa a continuación y dime qué va a crear antes de instalarla.`,
      pt: (t) =>
        `${t}\n\nVeja o que há disponível na central de modelos, recomende o que melhor se encaixa no que eu descrever em seguida e me diga o que ele vai criar antes de instalá-lo.`,
      vi: (t) =>
        `${t}\n\nHãy xem những gì có sẵn trong trung tâm mẫu, giới thiệu mẫu phù hợp nhất với những gì tôi mô tả tiếp theo, và cho tôi biết nó sẽ tạo ra những gì trước khi cài đặt.`,
      fr: (t) =>
        `${t}\n\nRegardez ce qui est disponible dans le centre de modèles, recommandez celui qui correspond le mieux à ce que je décrirai ensuite, et dites-moi ce qu'il va créer avant de l'installer.`,
      de: (t) =>
        `${t}\n\nSehen Sie sich an, was im Vorlagencenter verfügbar ist, empfehlen Sie die Vorlage, die am besten zu dem passt, was ich als Nächstes beschreibe, und sagen Sie mir, was sie erstellen wird, bevor Sie sie installieren.`,
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
  ko: (target, typeLabel, nodeType) =>
    `${target}\n\n여기에 ${typeLabel}(노드 유형: "${nodeType}") 항목을 새로 만들어 주세요.\n만들기 전에 이름과 그 밖에 필요한 정보를 저에게 물어봐 주세요.`,
  es: (target, typeLabel, nodeType) =>
    `${target}\n\nCrea aquí un nuevo elemento de tipo ${typeLabel} (tipo de nodo: «${nodeType}»).\nAntes de crearlo, pídeme su nombre y cualquier otro dato que necesites.`,
  pt: (target, typeLabel, nodeType) =>
    `${target}\n\nCrie aqui um novo item do tipo ${typeLabel} (tipo de nó: “${nodeType}”).\nAntes de criar, me pergunte o nome dele e qualquer outra informação de que precisar.`,
  vi: (target, typeLabel, nodeType) =>
    `${target}\n\nHãy tạo một ${typeLabel} mới (loại nút: “${nodeType}”) tại đây.\nTrước khi tạo, hãy hỏi tôi tên của nó và mọi thông tin khác bạn cần.`,
  fr: (target, typeLabel, nodeType) =>
    `${target}\n\nCréez ici un nouvel élément de type ${typeLabel} (type de nœud : « ${nodeType} »).\nAvant de le créer, demandez-moi son nom et tout ce dont vous avez encore besoin.`,
  de: (target, typeLabel, nodeType) =>
    `${target}\n\nErstellen Sie hier ein neues Element vom Typ ${typeLabel} (Knotentyp: „${nodeType}“).\nFragen Sie mich vor dem Erstellen nach dem Namen und allem, was Sie sonst noch brauchen.`,
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
        source: "capability",
        label: CREATE_ITEM_LABEL[locale](typeLabel),
        group: CREATE_GROUP_LABEL[locale],
        body: `${CREATE_CAPABILITY_TEMPLATE[locale](target, typeLabel, definition.type)}\n\n${
          MERGE_POLICY[locale]
        } ${REPLY_LANGUAGE[locale]}`,
      };
    });

  return { scenarios, capabilities };
}
