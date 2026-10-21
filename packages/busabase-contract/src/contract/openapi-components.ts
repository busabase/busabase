import type { AnySchema } from "@orpc/contract";
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
  fieldOptionsSchema,
} from "../domains/base/contract/base-schemas";
import { recordSchema } from "../domains/base/contract/record-schemas";
import {
  materializedBaseSchema,
  materializedRecordSchema,
  materializedViewSchema,
} from "../domains/base/contract/routes";
import { viewConfigSchema, viewSchema } from "../domains/base/contract/view-schemas";
import { materializedDocSchema } from "../domains/doc/contract";
import { materializedFileNodeSchema } from "../domains/file-node/contract";
import { fileTreeFileSchema, materializedFileTreeNodeSchema } from "../domains/filetree/contract";
import { FormVOSchema } from "../domains/form/types";
import {
  HtmlDocumentSchema,
  WhiteboardDocumentSchema,
  WorkflowDocumentSchema,
} from "../domains/rich-node/types";
import { VaultItemVOSchema, VaultSettingsVOSchema } from "../domains/vault/types";
import {
  WebhookDeliveryVOSchema,
  WebhookFunctionConfigVOSchema,
  WebhookHttpConfigVOSchema,
  WebhookRuleVOSchema,
} from "../domains/webhook/types";
import { NodeIconSchema } from "../types/node-icon";
import { activityItemSchema } from "./activity-schemas";
import {
  CreatedEmbedLinkVOSchema,
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
import { NODE_DETAIL_VARIANTS, NodeDetailVOSchema } from "./node-detail-schemas";
import {
  PlaybookAttributionVOSchema,
  PlaybookGetVOSchema,
  PlaybookSearchItemVOSchema,
} from "./playbook-schemas";
import {
  agentTaskSchema,
  auditEventSchema,
  changeRequestSchema,
  commentMentionSchema,
  commentSchema,
  commitSchema,
  nodeAgentPromptsSchema,
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
  union: { options: readonly AnySchema[] },
  key: string,
  value: string,
): AnySchema => {
  const match = union.options.find((option) => {
    const shape = (option as { shape?: Record<string, { value?: unknown }> }).shape;
    return shape?.[key]?.value === value;
  });
  if (!match) throw new Error(`OpenAPI components: no \`${key}: "${value}"\` variant in union`);
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
 * `strategy: "output"` — these are view objects. oRPC reuses the same
 * component for request bodies only when the input and output JSON Schema are
 * identical; where they differ (e.g. a field with a `.default()` is optional on
 * input but always present on output), input use sites stay inline.
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
  FileTreeFile: { strategy: "output", schema: fileTreeFileSchema },
  WhiteboardDocument: { strategy: "output", schema: WhiteboardDocumentSchema },
  WorkflowDocument: { strategy: "output", schema: WorkflowDocumentSchema },
  HtmlDocument: { strategy: "output", schema: HtmlDocumentSchema },
  // Bases
  Base: { strategy: "output", schema: baseSchema },
  BaseField: { strategy: "output", schema: baseFieldSchema },
  FieldOptions: { strategy: "output", schema: fieldOptionsSchema },
  Record: { strategy: "output", schema: recordSchema },
  View: { strategy: "output", schema: viewSchema },
  ViewConfig: { strategy: "output", schema: viewConfigSchema },
  Form: { strategy: "output", schema: FormVOSchema },
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
  UserRef: { strategy: "output", schema: userRefSchema },
  SourceAttribution: { strategy: "output", schema: sourceAttributionSchema },
  PlaybookAttribution: { strategy: "output", schema: PlaybookAttributionVOSchema },
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
  WebhookFunctionConfig: { strategy: "output", schema: WebhookFunctionConfigVOSchema },
  WebhookDelivery: { strategy: "output", schema: WebhookDeliveryVOSchema },
  EmbedLink: { strategy: "output", schema: EmbedLinkVOSchema },
  CreatedEmbedLink: { strategy: "output", schema: CreatedEmbedLinkVOSchema },
  EmbedFramePolicy: { strategy: "output", schema: EmbedFramePolicyVOSchema },
  VaultItem: { strategy: "output", schema: VaultItemVOSchema },
  VaultSettings: { strategy: "output", schema: VaultSettingsVOSchema },
  AgentTask: { strategy: "output", schema: agentTaskSchema },
  // Errors — referenced via `busabaseOpenApiErrorResponseBodySchema`
  [API_ERROR_COMPONENT]: { strategy: "output", schema: apiErrorSchema },
} as const satisfies Record<string, { strategy: "input" | "output"; schema: AnySchema }>;
