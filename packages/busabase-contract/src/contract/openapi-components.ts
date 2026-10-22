import type { AnySchema } from "@orpc/contract";
import { iStringRecordSchema } from "openlib/i18n/i-string";
import { z } from "zod";
import {
  AssetDetailVOSchema,
  AssetUsageVOSchema,
  AssetVOSchema,
  GrepMatchOwnerVOSchema,
  ReadLinesVOSchema,
} from "../domains/assets/types";
import {
  baseFieldSchema,
  baseSchema,
  fieldHelpSchema,
  fieldNameSchema,
  fieldOptionsSchema,
} from "../domains/base/contract/base-schemas";
import {
  listRecordsFilterSchema,
  listRecordsSortSchema,
  listRecordsValueFilterNodeSchema,
  listRecordsValueFilterSchema,
  recordSchema,
} from "../domains/base/contract/record-schemas";
import {
  materializedBaseSchema,
  materializedRecordSchema,
  materializedViewSchema,
} from "../domains/base/contract/routes";
import {
  viewChangeRequestInputSchema,
  viewConfigSchema,
  viewFilterSchema,
  viewSchema,
  viewSortSchema,
} from "../domains/base/contract/view-schemas";
import { materializedDocSchema } from "../domains/doc/contract";
import { materializedFileNodeSchema } from "../domains/file-node/contract";
import {
  createFileTreeInputSchema,
  filePreviewSchema,
  fileTreeFileOperationInputSchema,
  fileTreeFileSchema,
  materializedFileTreeNodeSchema,
} from "../domains/filetree/contract";
import {
  FormFieldBindingSchema,
  FormPageSourceSchema,
  FormShareSchema,
  FormThemeSchema,
  FormVOSchema,
} from "../domains/form/types";
import {
  HtmlDocumentSchema,
  WhiteboardDocumentSchema,
  WorkflowDocumentSchema,
  WorkflowNodeSchema,
} from "../domains/rich-node/types";
import { VaultItemVOSchema, VaultSettingsVOSchema } from "../domains/vault/types";
import {
  WebhookDeliveryVOSchema,
  WebhookFunctionConfigVOSchema,
  WebhookHttpConfigSchema,
  WebhookHttpConfigVOSchema,
  WebhookRuleInputSchema,
  WebhookRuleVOSchema,
} from "../domains/webhook/types";
import { NodeIconSchema } from "../types/node-icon";
import { activityItemSchema } from "./activity-schemas";
import { AgentClientVOSchema } from "./agent-client";
import {
  changeRequestMergeBatchResultSchema,
  changeRequestReviewBatchResultSchema,
} from "./busabase";
import {
  CreatedEmbedLinkVOSchema,
  EmbedFramePolicyInputSchema,
  EmbedFramePolicyVOSchema,
  EmbedLinkVOSchema,
} from "./embed-link-schemas";
import {
  UnifiedGrepFileMatchVOSchema,
  UnifiedGrepMatchVOSchema,
  UnifiedGrepNodeMatchVOSchema,
  UnifiedGrepPromptMatchVOSchema,
  UnifiedGrepRecordMatchVOSchema,
  UnifiedGrepResultVOSchema,
} from "./grep-schemas";
import { customPromptDefSchema } from "./node-agent-prompt-schemas";
import { nodeContentInputSchema } from "./node-content-schemas";
import { NODE_DETAIL_VARIANTS, NodeDetailVOSchema } from "./node-detail-schemas";
import { NodeRouteStateVOSchema } from "./node-route-state-schemas";
import {
  PlaybookAttributionVOSchema,
  PlaybookGetVOSchema,
  PlaybookSearchItemVOSchema,
} from "./playbook-schemas";
import {
  agentTaskSchema,
  auditEventSchema,
  authInfoSchema,
  changeRequestSchema,
  commentMentionSchema,
  commentSchema,
  commitSchema,
  nodeAgentPromptsSchema,
  nodeOperationInputSchema,
  nodeSchema,
  nodeSearchResultSchema,
  nodeSettingsSchema,
  nodeShareSchema,
  operationSchema,
  pendingChangeRequestSchema,
  reviewSchema,
  searchResultSchema,
  sourceAttributionSchema,
  userRefSchema,
} from "./schemas";

/**
 * The `/api/v1` error body both servers actually send (see
 * `busabase-core/src/openapi/error-envelope.ts`, `encodeBusabaseOpenApiError`):
 * `{ error, code, data }`. When a handler shaped its own `{ error, … }` data,
 * those fields are spread into the body next to `code` — hence loose.
 *
 * oRPC's generator would otherwise document its own default error shape
 * (`{ defined, code, status, message, data }`), which no Busabase server
 * returns, so a generated SDK would fail to parse every real error body.
 */
export const apiErrorSchema = z
  .looseObject({
    error: z.string().describe("Human-readable message."),
    code: z
      .string()
      .describe("Semantic outcome, e.g. `NOT_FOUND`, `FORBIDDEN`, `BAD_REQUEST`, `CONFLICT`."),
    data: z
      .unknown()
      .optional()
      .describe("Extra detail, e.g. a validation failure's field-level `issues`."),
  })
  .describe("Error response body returned by every `/api/v1` endpoint.");

const API_ERROR_COMPONENT = "Error";

/**
 * Pass as `customErrorResponseBodySchema` to `OpenAPIGenerator.generate()` so
 * every documented error response points at the shared `Error` component.
 */
export const busabaseOpenApiErrorResponseBodySchema = {
  $ref: `#/components/schemas/${API_ERROR_COMPONENT}`,
} as const;

/**
 * The exact variant instance a discriminated union holds for one discriminator
 * value. Registering union variants by name (`NodeIconEmoji`, …) instead of
 * leaving them as anonymous `anyOf` members is what lets SDK generators emit
 * one class per variant — openapi-python-client otherwise names them
 * `NodeIconType1` and, for variants with nested objects, refuses to generate
 * them at all ("Attempted to generate duplicate models"). Throws at load time
 * if the contract drops the variant, so a rename cannot silently un-name it.
 */
const variantOf = (
  union: { options: readonly AnySchema[] } | AnySchema,
  key: string,
  value: string | boolean,
): AnySchema => {
  const match = optionsOf(union).find((option) => {
    const shape = (option as { shape?: Record<string, { value?: unknown }> }).shape;
    return shape?.[key]?.value === value;
  });
  if (!match)
    throw new Error(`OpenAPI components: no \`${key}: ${JSON.stringify(value)}\` variant in union`);
  return match;
};

/** Internal zod v4 node, enough to walk wrappers without importing zod internals. */
type ZodNode = {
  _zod: {
    def: {
      type: string;
      innerType?: ZodNode;
      element?: ZodNode;
      in?: ZodNode;
      options?: readonly ZodNode[];
      shape?: Record<string, ZodNode>;
    };
  };
};

/** Wrappers that do not change which object a use site ends up converting. */
const TRANSPARENT = new Set([
  "optional",
  "nullable",
  "default",
  "prefault",
  "readonly",
  "nonoptional",
]);

/** Strip `.optional()` / `.nullable()` / `.default()` / arrays / a pipe's input side. */
const unwrap = (schema: AnySchema): AnySchema => {
  let node = schema as unknown as ZodNode;
  for (;;) {
    const def = node._zod.def;
    if (TRANSPARENT.has(def.type) && def.innerType) node = def.innerType;
    else if (def.type === "array" && def.element) node = def.element;
    else if (def.type === "pipe" && def.in) node = def.in;
    else return node as unknown as AnySchema;
  }
};

const optionsOf = (union: { options: readonly AnySchema[] } | AnySchema): readonly AnySchema[] => {
  const options = (unwrap(union as AnySchema) as unknown as ZodNode)._zod.def.options;
  if (!options) throw new Error("OpenAPI components: expected a union");
  return options as unknown as readonly AnySchema[];
};

/**
 * The schema INSTANCE a property of an object holds, through any optional /
 * nullable / default / array wrappers — `memberOf(baseSchema, "reviewPolicy")`.
 * For the shapes the contract writes inline rather than exporting by name.
 * Throws at load time if the property is gone, like `variantOf`.
 */
const memberOf = (schema: AnySchema, ...path: string[]): AnySchema => {
  let node = unwrap(schema);
  for (const key of path) {
    const child = (node as unknown as ZodNode)._zod.def.shape?.[key];
    if (!child) throw new Error(`OpenAPI components: no \`${path.join(".")}\` property`);
    node = unwrap(child as unknown as AnySchema);
  }
  return node;
};

/** The member of a plain (non-discriminated) union that has property `key`. */
const optionWith = (union: AnySchema, key: string): AnySchema => {
  const match = optionsOf(union).find(
    (option) => (option as unknown as ZodNode)._zod.def.shape?.[key] !== undefined,
  );
  if (!match) throw new Error(`OpenAPI components: no union member with \`${key}\``);
  return match;
};

/**
 * Named, shared component schemas for the public OpenAPI document.
 *
 * Without this, oRPC's `OpenAPIGenerator` inlines every schema at every use
 * site: `ChangeRequest` alone is repeated in ~22 operations and the whole
 * document has zero `components.schemas`. Off-the-shelf SDK generators
 * (openapi-python-client, openapi-generator, Stainless, Speakeasy) then emit one
 * auto-named model per use site instead of one `ChangeRequest` model.
 *
 * Pass this as `commonSchemas` to `OpenAPIGenerator.generate()` — oRPC's native
 * mechanism. It matches by schema INSTANCE identity, so registering a schema
 * here changes nothing about validation or the wire format, and nothing about
 * the zod schemas themselves (`busabase-cli schema` and other
 * `z.toJSONSchema` consumers keep seeing fully inlined JSON Schema). A use site
 * that wraps the schema (`.extend()`, `.describe()`, `.meta()`) is a different
 * instance and simply stays inline.
 *
 * Names are public SDK surface (they become class names in generated
 * clients): keep them stable, PascalCase, and free of `Schema`/`VO` suffixes.
 *
 * `strategy: "output"` — view objects. oRPC reuses the same component for
 * request bodies only when the input and output JSON Schema are identical;
 * where they differ (e.g. a field with a `.default()` is optional on input but
 * always present on output), input use sites stay inline.
 *
 * `strategy: "input"` — request-side shapes (DTOs). Same rule in reverse.
 * Where one zod instance is both a VO and a DTO and the two JSON Schemas
 * differ, it is registered twice: the VO under its plain name, the DTO with an
 * `Input` suffix (`WebhookHttpConfig` / `WebhookHttpConfigInput`).
 *
 * Which shapes get a name (the rest keep the generator's operation-derived
 * name, e.g. `DocsCreateBody`, `GrepBodyScope`):
 * 1. Every member of a union. A generator can only call those `…Type0`,
 *    `…Type1` — positional names that say nothing and change when the union
 *    is reordered. (Not the unions oRPC flattens into one object because the
 *    route also has path parameters: `records.changeRequest`, `webhooks.update`.)
 * 2. Every shape that appears at two or more places in the document — one
 *    model instead of one per use site (`RecordFilter`, `FormShare`,
 *    `FieldChoice`).
 * 3. Never a whole request body or response: the operation already names it
 *    precisely, and a shape used once gains nothing from a second name.
 */
export const busabaseOpenApiCommonSchemas = {
  // Workspace tree
  Node: { strategy: "output", schema: nodeSchema },
  NodeDetail: { strategy: "output", schema: NodeDetailVOSchema },
  FolderNodeDetail: { strategy: "output", schema: NODE_DETAIL_VARIANTS.folder },
  DocNodeDetail: { strategy: "output", schema: NODE_DETAIL_VARIANTS.doc },
  FileNodeDetail: { strategy: "output", schema: NODE_DETAIL_VARIANTS.file },
  SkillNodeDetail: { strategy: "output", schema: NODE_DETAIL_VARIANTS.skill },
  DriveNodeDetail: { strategy: "output", schema: NODE_DETAIL_VARIANTS.drive },
  AirAppNodeDetail: { strategy: "output", schema: NODE_DETAIL_VARIANTS.airapp },
  BaseNodeDetail: { strategy: "output", schema: NODE_DETAIL_VARIANTS.base },
  FormNodeDetail: { strategy: "output", schema: NODE_DETAIL_VARIANTS.form },
  WhiteboardNodeDetail: { strategy: "output", schema: NODE_DETAIL_VARIANTS.whiteboard },
  WorkflowNodeDetail: { strategy: "output", schema: NODE_DETAIL_VARIANTS.workflow },
  HtmlNodeDetail: { strategy: "output", schema: NODE_DETAIL_VARIANTS.html },
  NodeSearchResult: { strategy: "output", schema: nodeSearchResultSchema },
  NodeSettings: { strategy: "output", schema: nodeSettingsSchema },
  NodeIcon: { strategy: "output", schema: NodeIconSchema },
  NodeIconEmoji: { strategy: "output", schema: variantOf(NodeIconSchema, "type", "emoji") },
  NodeIconAttachment: {
    strategy: "output",
    schema: variantOf(NodeIconSchema, "type", "attachment"),
  },
  NodeShare: { strategy: "output", schema: nodeShareSchema },
  NodeAgentPrompts: { strategy: "output", schema: nodeAgentPromptsSchema },
  NodeAgentPrompt: { strategy: "output", schema: customPromptDefSchema },
  ActiveNodeRouteState: {
    strategy: "output",
    schema: variantOf(NodeRouteStateVOSchema, "status", "active"),
  },
  ArchivedNodeRouteState: {
    strategy: "output",
    schema: variantOf(NodeRouteStateVOSchema, "status", "archived"),
  },
  UnavailableNodeRouteState: {
    strategy: "output",
    schema: variantOf(NodeRouteStateVOSchema, "status", "unavailable"),
  },
  // `nodes.createChangeRequest` — one entry of `operations`, by `kind`.
  CreateNodeOperation: {
    strategy: "input",
    schema: variantOf(nodeOperationInputSchema, "kind", "create"),
  },
  RenameNodeOperation: {
    strategy: "input",
    schema: variantOf(nodeOperationInputSchema, "kind", "rename"),
  },
  MoveNodeOperation: {
    strategy: "input",
    schema: variantOf(nodeOperationInputSchema, "kind", "move"),
  },
  DeleteNodeOperation: {
    strategy: "input",
    schema: variantOf(nodeOperationInputSchema, "kind", "delete"),
  },
  RestoreNodeOperation: {
    strategy: "input",
    schema: variantOf(nodeOperationInputSchema, "kind", "restore"),
  },
  // `nodes.updateContent` — the new document, by the node's type.
  DocNodeContent: { strategy: "input", schema: variantOf(nodeContentInputSchema, "kind", "doc") },
  WhiteboardNodeContent: {
    strategy: "input",
    schema: variantOf(nodeContentInputSchema, "kind", "whiteboard"),
  },
  WorkflowNodeContent: {
    strategy: "input",
    schema: variantOf(nodeContentInputSchema, "kind", "workflow"),
  },
  HtmlNodeContent: { strategy: "input", schema: variantOf(nodeContentInputSchema, "kind", "html") },
  FileTreeFile: { strategy: "output", schema: fileTreeFileSchema },
  // `fileTrees.create` — one entry of `files`: an uploaded Asset, or text.
  AssetFileInput: {
    strategy: "input",
    schema: optionWith(memberOf(createFileTreeInputSchema, "files"), "assetId"),
  },
  TextFileInput: {
    strategy: "input",
    schema: optionWith(memberOf(createFileTreeInputSchema, "files"), "content"),
  },
  // `fileTrees.createChangeRequest` — one entry of `operations`.
  AssetFileOperation: {
    strategy: "input",
    schema: optionWith(fileTreeFileOperationInputSchema, "assetId"),
  },
  TextFileOperation: {
    strategy: "input",
    schema: optionWith(fileTreeFileOperationInputSchema, "content"),
  },
  DeleteFileOperation: {
    strategy: "input",
    schema: variantOf(fileTreeFileOperationInputSchema, "kind", "delete"),
  },
  FileTreeMetadataOperation: {
    strategy: "input",
    schema: variantOf(fileTreeFileOperationInputSchema, "kind", "metadata_update"),
  },
  // `fileTrees.preparePreview`, by `state`.
  BuiltinFilePreview: {
    strategy: "output",
    schema: variantOf(filePreviewSchema, "state", "builtin"),
  },
  ReadyFilePreview: { strategy: "output", schema: variantOf(filePreviewSchema, "state", "ready") },
  UnavailableFilePreview: {
    strategy: "output",
    schema: variantOf(filePreviewSchema, "state", "unavailable"),
  },
  WhiteboardDocument: { strategy: "output", schema: WhiteboardDocumentSchema },
  WorkflowDocument: { strategy: "output", schema: WorkflowDocumentSchema },
  TriggerWorkflowNode: {
    strategy: "output",
    schema: variantOf(WorkflowNodeSchema, "kind", "trigger"),
  },
  WebhookWorkflowNode: {
    strategy: "output",
    schema: variantOf(WorkflowNodeSchema, "kind", "webhook"),
  },
  FunctionWorkflowNode: {
    strategy: "output",
    schema: variantOf(WorkflowNodeSchema, "kind", "function"),
  },
  ConditionWorkflowNode: {
    strategy: "output",
    schema: variantOf(WorkflowNodeSchema, "kind", "condition"),
  },
  WaitWorkflowNode: { strategy: "output", schema: variantOf(WorkflowNodeSchema, "kind", "wait") },
  ApprovalWorkflowNode: {
    strategy: "output",
    schema: variantOf(WorkflowNodeSchema, "kind", "approval"),
  },
  ActionWorkflowNode: {
    strategy: "output",
    schema: variantOf(WorkflowNodeSchema, "kind", "action"),
  },
  EndWorkflowNode: { strategy: "output", schema: variantOf(WorkflowNodeSchema, "kind", "end") },
  WorkflowNodePosition: {
    strategy: "output",
    schema: memberOf(variantOf(WorkflowNodeSchema, "kind", "trigger"), "position"),
  },
  HtmlDocument: { strategy: "output", schema: HtmlDocumentSchema },
  // Bases
  Base: { strategy: "output", schema: baseSchema },
  BaseField: { strategy: "output", schema: baseFieldSchema },
  // The object inside `fieldOptionsSchema`'s `.default({})`, so the
  // field-update patch (which unwraps that default) shares the component too;
  // the `{}` default moves onto the use sites that carry it.
  FieldOptions: { strategy: "output", schema: fieldOptionsSchema.removeDefault() },
  // The parts of `FieldOptions`, named so the field-update patch reuses them
  // instead of carrying its own copy of each.
  FieldHelp: { strategy: "output", schema: fieldHelpSchema },
  FieldChoice: { strategy: "output", schema: memberOf(fieldOptionsSchema, "choices") },
  FieldOptionsAi: { strategy: "output", schema: memberOf(fieldOptionsSchema, "ai") },
  FieldOptionsAttachment: {
    strategy: "output",
    schema: memberOf(fieldOptionsSchema, "attachment"),
  },
  FieldOptionsCode: { strategy: "output", schema: memberOf(fieldOptionsSchema, "code") },
  FieldOptionsDate: { strategy: "output", schema: memberOf(fieldOptionsSchema, "date") },
  FieldOptionsEmbed: { strategy: "output", schema: memberOf(fieldOptionsSchema, "embed") },
  FieldOptionsFormula: { strategy: "output", schema: memberOf(fieldOptionsSchema, "formula") },
  FieldOptionsLookup: { strategy: "output", schema: memberOf(fieldOptionsSchema, "lookup") },
  FieldOptionsNumber: { strategy: "output", schema: memberOf(fieldOptionsSchema, "number") },
  // A field name is a plain string or this locale-keyed record.
  LocalizedFieldName: { strategy: "output", schema: optionsOf(fieldNameSchema)[1] as AnySchema },
  BaseReviewPolicy: { strategy: "output", schema: memberOf(baseSchema, "reviewPolicy") },
  Record: { strategy: "output", schema: recordSchema },
  View: { strategy: "output", schema: viewSchema },
  ViewConfig: { strategy: "output", schema: viewConfigSchema },
  ViewFilter: { strategy: "output", schema: viewFilterSchema },
  ViewSort: { strategy: "output", schema: viewSortSchema },
  // `views.changeRequest`, by `operation`.
  CreateViewOperation: {
    strategy: "input",
    schema: variantOf(viewChangeRequestInputSchema, "operation", "create"),
  },
  UpdateViewOperation: {
    strategy: "input",
    schema: variantOf(viewChangeRequestInputSchema, "operation", "update"),
  },
  DeleteViewOperation: {
    strategy: "input",
    schema: variantOf(viewChangeRequestInputSchema, "operation", "delete"),
  },
  RestoreViewOperation: {
    strategy: "input",
    schema: variantOf(viewChangeRequestInputSchema, "operation", "restore"),
  },
  // `records.list` / `listPage` / `count` / `groupBy` query parameters.
  RecordFilter: { strategy: "input", schema: listRecordsFilterSchema },
  RecordSort: { strategy: "input", schema: listRecordsSortSchema },
  RecordValueFilter: { strategy: "input", schema: listRecordsValueFilterNodeSchema },
  RecordValueComparison: { strategy: "input", schema: listRecordsValueFilterSchema },
  RecordValueAnyOf: {
    strategy: "input",
    schema: optionWith(listRecordsValueFilterNodeSchema, "any"),
  },
  Form: { strategy: "output", schema: FormVOSchema },
  FormFieldBinding: { strategy: "output", schema: FormFieldBindingSchema },
  FormPage: { strategy: "output", schema: FormPageSourceSchema },
  FormTheme: { strategy: "output", schema: FormThemeSchema },
  FormShare: { strategy: "output", schema: FormShareSchema },
  // What a create that merged in the same call returns (the other branch of
  // each write's response is `PendingChangeRequest`).
  MaterializedBase: { strategy: "output", schema: materializedBaseSchema },
  MaterializedRecord: { strategy: "output", schema: materializedRecordSchema },
  MaterializedView: { strategy: "output", schema: materializedViewSchema },
  MaterializedDoc: { strategy: "output", schema: materializedDocSchema },
  MaterializedFile: { strategy: "output", schema: materializedFileNodeSchema },
  MaterializedFileTree: { strategy: "output", schema: materializedFileTreeNodeSchema },
  // Change requests and history
  ChangeRequest: { strategy: "output", schema: changeRequestSchema },
  PendingChangeRequest: { strategy: "output", schema: pendingChangeRequestSchema },
  Operation: { strategy: "output", schema: operationSchema },
  Commit: { strategy: "output", schema: commitSchema },
  Review: { strategy: "output", schema: reviewSchema },
  // `changeRequests.review` / `merge` — one entry of `results`, by `ok`.
  ChangeRequestReviewSuccess: {
    strategy: "output",
    schema: variantOf(memberOf(changeRequestReviewBatchResultSchema, "results"), "ok", true),
  },
  ChangeRequestMergeSuccess: {
    strategy: "output",
    schema: variantOf(memberOf(changeRequestMergeBatchResultSchema, "results"), "ok", true),
  },
  ChangeRequestBatchFailure: {
    strategy: "output",
    schema: variantOf(memberOf(changeRequestMergeBatchResultSchema, "results"), "ok", false),
  },
  UserRef: { strategy: "output", schema: userRefSchema },
  AuthSpace: { strategy: "output", schema: memberOf(authInfoSchema, "space") },
  // Any other localized text (`{ "en": "…", "zh-CN": "…" }`): prompt labels and
  // bodies, template and package display names.
  LocalizedText: { strategy: "output", schema: iStringRecordSchema },
  SourceAttribution: { strategy: "output", schema: sourceAttributionSchema },
  PlaybookAttribution: { strategy: "output", schema: PlaybookAttributionVOSchema },
  AgentClient: { strategy: "output", schema: AgentClientVOSchema },
  ActivityItem: { strategy: "output", schema: activityItemSchema },
  ChangeRequestActivity: {
    strategy: "output",
    schema: variantOf(activityItemSchema, "kind", "change_request"),
  },
  OperationActivity: {
    strategy: "output",
    schema: variantOf(activityItemSchema, "kind", "operation"),
  },
  RecordActivity: { strategy: "output", schema: variantOf(activityItemSchema, "kind", "record") },
  AuditActivity: { strategy: "output", schema: variantOf(activityItemSchema, "kind", "audit") },
  AuditEvent: { strategy: "output", schema: auditEventSchema },
  Comment: { strategy: "output", schema: commentSchema },
  CommentMention: { strategy: "output", schema: commentMentionSchema },
  // Search, grep, playbooks
  SearchResult: { strategy: "output", schema: searchResultSchema },
  GrepResult: { strategy: "output", schema: UnifiedGrepResultVOSchema },
  GrepMatch: { strategy: "output", schema: UnifiedGrepMatchVOSchema },
  GrepFileMatch: { strategy: "output", schema: UnifiedGrepFileMatchVOSchema },
  GrepNodeMatch: { strategy: "output", schema: UnifiedGrepNodeMatchVOSchema },
  GrepRecordMatch: { strategy: "output", schema: UnifiedGrepRecordMatchVOSchema },
  GrepPromptMatch: { strategy: "output", schema: UnifiedGrepPromptMatchVOSchema },
  GrepMatchOwner: { strategy: "output", schema: GrepMatchOwnerVOSchema },
  PlaybookSearchItem: { strategy: "output", schema: PlaybookSearchItemVOSchema },
  Playbook: { strategy: "output", schema: PlaybookGetVOSchema },
  // Assets
  Asset: { strategy: "output", schema: AssetVOSchema },
  AssetDetail: { strategy: "output", schema: AssetDetailVOSchema },
  AssetUsage: { strategy: "output", schema: AssetUsageVOSchema },
  ReadLinesResult: { strategy: "output", schema: ReadLinesVOSchema },
  // Integrations
  WebhookRule: { strategy: "output", schema: WebhookRuleVOSchema },
  HttpWebhookRule: {
    strategy: "output",
    schema: variantOf(WebhookRuleVOSchema, "actionKind", "webhook"),
  },
  NotifyAgentWebhookRule: {
    strategy: "output",
    schema: variantOf(WebhookRuleVOSchema, "actionKind", "notify_agent"),
  },
  RunFunctionWebhookRule: {
    strategy: "output",
    schema: variantOf(WebhookRuleVOSchema, "actionKind", "run_function"),
  },
  WebhookHttpConfig: { strategy: "output", schema: WebhookHttpConfigVOSchema },
  WebhookHttpConfigInput: { strategy: "input", schema: WebhookHttpConfigSchema },
  // `webhooks.create`, by `actionKind`.
  HttpWebhookRuleInput: {
    strategy: "input",
    schema: variantOf(WebhookRuleInputSchema, "actionKind", "webhook"),
  },
  NotifyAgentWebhookRuleInput: {
    strategy: "input",
    schema: variantOf(WebhookRuleInputSchema, "actionKind", "notify_agent"),
  },
  RunFunctionWebhookRuleInput: {
    strategy: "input",
    schema: variantOf(WebhookRuleInputSchema, "actionKind", "run_function"),
  },
  WebhookFunctionConfig: { strategy: "output", schema: WebhookFunctionConfigVOSchema },
  WebhookDelivery: { strategy: "output", schema: WebhookDeliveryVOSchema },
  EmbedLink: { strategy: "output", schema: EmbedLinkVOSchema },
  CreatedEmbedLink: { strategy: "output", schema: CreatedEmbedLinkVOSchema },
  EmbedFramePolicy: { strategy: "output", schema: EmbedFramePolicyVOSchema },
  // `embedLinks.create` — where the embed may be framed, by `mode`.
  EmbedFramePolicyAnywhere: {
    strategy: "input",
    schema: variantOf(EmbedFramePolicyInputSchema, "mode", "anywhere"),
  },
  EmbedFramePolicyOrigins: {
    strategy: "input",
    schema: variantOf(EmbedFramePolicyInputSchema, "mode", "origins"),
  },
  EmbedFramePolicyTopLevelOnly: {
    strategy: "input",
    schema: variantOf(EmbedFramePolicyInputSchema, "mode", "top-level-only"),
  },
  VaultItem: { strategy: "output", schema: VaultItemVOSchema },
  VaultSettings: { strategy: "output", schema: VaultSettingsVOSchema },
  AgentTask: { strategy: "output", schema: agentTaskSchema },
  // Errors — referenced via `busabaseOpenApiErrorResponseBodySchema`
  [API_ERROR_COMPONENT]: { strategy: "output", schema: apiErrorSchema },
} as const satisfies Record<string, { strategy: "input" | "output"; schema: AnySchema }>;
