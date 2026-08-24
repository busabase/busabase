import { z } from "zod";
import { type NodeType } from "../domains/registry";
import { type NodeIcon } from "../types/node-icon";
export interface NodeOutput {
  id: string;
  parentId: string | null;
  type: NodeType;
  slug: string;
  name: string;
  description: string;
  /**
   * Free-form extension data. The product reads NOTHING here — it is the
   * caller's bag (busabase-cms keeps its Base-id mapping in it), plus `version`,
   * a label the user writes and the product never interprets.
   *
   * `visibility` moved up to a first-class field below; `entryFile` is read off
   * the node type; `assetId` is read from the asset-usage row. See
   * `content/spec/node-content-storage.md` (D1).
   */
  metadata: Record<string, unknown> & {
    version?: string;
  };
  /**
   * This node's OWN declared visibility, or null when it simply inherits from
   * its ancestors. Access control, so it is a real column rather than a
   * metadata key — only `POST /nodes/{nodeId}/visibility` (which requires
   * `manage`) can change it.
   */
  explicitVisibility: "private" | "workspace" | "public" | null;
  /**
   * This node's custom avatar (emoji or cropped/uploaded image), or `null`
   * when it has none and every host falls back to its type icon. See
   * `NodeIconSchema` (`../types/node-icon`) for the two variants.
   */
  icon?: NodeIcon | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  baseId: string | null;
  children: NodeOutput[];
  /**
   * Whether this node has children beyond what `children` carries. Always
   * accurate when the full subtree was loaded (equals `children.length > 0`).
   * The one case it differs: a node sitting exactly at a `nodes.list` `depth`
   * boundary — `children` is `[]` (not fetched) but `hasChildren` is `true`,
   * telling the sidebar to render an expand affordance and lazy-fetch on
   * click instead of rendering it as a leaf. Optional or missing means the
   * caller can safely treat it as `children.length > 0` (which is exactly
   * what it equals whenever it's omitted).
   */
  hasChildren?: boolean;
}
declare const nodeSchema: z.ZodType<NodeOutput>;
declare const nodePrincipalSchema: z.ZodObject<
  {
    id: z.ZodString;
    nodeId: z.ZodString;
    principalType: z.ZodEnum<{
      space: "space";
      team: "team";
      user: "user";
    }>;
    principalId: z.ZodString;
    role: z.ZodEnum<{
      changeRequest: "changeRequest";
      manage: "manage";
      read: "read";
      write: "write";
    }>;
    grantedBy: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
  },
  z.core.$strip
>;
declare const nodeShareSchema: z.ZodObject<
  {
    nodeId: z.ZodString;
    scope: z.ZodEnum<{
      none: "none";
      public: "public";
    }>;
    capability: z.ZodEnum<{
      read: "read";
      submit: "submit";
    }>;
    hasPassword: z.ZodBoolean;
    expiresAt: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodString;
  },
  z.core.$strip
>;
declare const listNodesInputSchema: z.ZodOptional<
  z.ZodObject<
    {
      parentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
      depth: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
      status: z.ZodDefault<
        z.ZodOptional<
          z.ZodEnum<{
            active: "active";
            archived: "archived";
          }>
        >
      >;
      types: z.ZodOptional<
        z.ZodPipe<
          z.ZodUnion<
            readonly [
              z.ZodArray<
                z.ZodEnum<{
                  [x: string]: string;
                }>
              >,
              z.ZodEnum<{
                [x: string]: string;
              }>,
            ]
          >,
          z.ZodTransform<string[], string | string[]>
        >
      >;
    },
    z.core.$strip
  >
>;
declare const isDescendantInputSchema: z.ZodObject<
  {
    nodeId: z.ZodString;
    potentialAncestorId: z.ZodString;
  },
  z.core.$strip
>;
declare const isDescendantOutputSchema: z.ZodObject<
  {
    isDescendant: z.ZodBoolean;
  },
  z.core.$strip
>;
declare const updateNodeMetadataInputSchema: z.ZodObject<
  {
    nodeId: z.ZodString;
    metadata: z.ZodRecord<z.ZodString, z.ZodUnknown>;
  },
  z.core.$strip
>;
declare const searchNodesByNameInputSchema: z.ZodObject<
  {
    query: z.ZodString;
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
  },
  z.core.$strip
>;
declare const nodeSearchResultSchema: z.ZodObject<
  {
    id: z.ZodString;
    type: z.ZodEnum<{
      [x: string]: string;
    }>;
    name: z.ZodString;
    slug: z.ZodString;
    path: z.ZodString;
    updatedAt: z.ZodString;
  },
  z.core.$strip
>;
declare const userRefSchema: z.ZodObject<
  {
    id: z.ZodString;
    name: z.ZodNullable<z.ZodString>;
    email: z.ZodNullable<z.ZodString>;
    image: z.ZodNullable<z.ZodString>;
    role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  },
  z.core.$strip
>;
declare const commitSchema: z.ZodObject<
  {
    id: z.ZodString;
    baseId: z.ZodNullable<z.ZodString>;
    targetType: z.ZodEnum<{
      base: "base";
      node: "node";
    }>;
    nodeId: z.ZodNullable<z.ZodString>;
    operationId: z.ZodNullable<z.ZodString>;
    parentCommitId: z.ZodNullable<z.ZodString>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    operation: z.ZodEnum<{
      [x: `${string}_file_create`]: `${string}_file_create`;
      [x: `${string}_file_delete`]: `${string}_file_delete`;
      [x: `${string}_file_update`]: `${string}_file_update`;
      [x: `${string}_metadata_update`]: `${string}_metadata_update`;
      base_add_field: "base_add_field";
      base_archive: "base_archive";
      base_convert_field: "base_convert_field";
      base_delete_field: "base_delete_field";
      base_reorder_fields: "base_reorder_fields";
      base_restore: "base_restore";
      base_restore_field: "base_restore_field";
      base_update_field: "base_update_field";
      doc_update: "doc_update";
      html_document_update: "html_document_update";
      node_create: "node_create";
      node_delete: "node_delete";
      node_move: "node_move";
      node_rename: "node_rename";
      node_restore: "node_restore";
      record_create: "record_create";
      record_delete: "record_delete";
      record_restore: "record_restore";
      record_update: "record_update";
      record_variant: "record_variant";
      view_create: "view_create";
      view_delete: "view_delete";
      view_restore: "view_restore";
      view_update: "view_update";
      whiteboard_document_update: "whiteboard_document_update";
      workflow_document_update: "workflow_document_update";
    }>;
    message: z.ZodString;
    author: z.ZodString;
    authorUser: z.ZodDefault<
      z.ZodOptional<
        z.ZodNullable<
          z.ZodObject<
            {
              id: z.ZodString;
              name: z.ZodNullable<z.ZodString>;
              email: z.ZodNullable<z.ZodString>;
              image: z.ZodNullable<z.ZodString>;
              role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            },
            z.core.$strip
          >
        >
      >
    >;
    createdAt: z.ZodString;
  },
  z.core.$strip
>;
declare const operationSchema: z.ZodObject<
  {
    id: z.ZodString;
    changeRequestId: z.ZodString;
    baseId: z.ZodNullable<z.ZodString>;
    targetType: z.ZodEnum<{
      base: "base";
      node: "node";
    }>;
    nodeId: z.ZodNullable<z.ZodString>;
    operation: z.ZodEnum<{
      [x: `${string}_file_create`]: `${string}_file_create`;
      [x: `${string}_file_delete`]: `${string}_file_delete`;
      [x: `${string}_file_update`]: `${string}_file_update`;
      [x: `${string}_metadata_update`]: `${string}_metadata_update`;
      base_add_field: "base_add_field";
      base_archive: "base_archive";
      base_convert_field: "base_convert_field";
      base_delete_field: "base_delete_field";
      base_reorder_fields: "base_reorder_fields";
      base_restore: "base_restore";
      base_restore_field: "base_restore_field";
      base_update_field: "base_update_field";
      doc_update: "doc_update";
      html_document_update: "html_document_update";
      node_create: "node_create";
      node_delete: "node_delete";
      node_move: "node_move";
      node_rename: "node_rename";
      node_restore: "node_restore";
      record_create: "record_create";
      record_delete: "record_delete";
      record_restore: "record_restore";
      record_update: "record_update";
      record_variant: "record_variant";
      view_create: "view_create";
      view_delete: "view_delete";
      view_restore: "view_restore";
      view_update: "view_update";
      whiteboard_document_update: "whiteboard_document_update";
      workflow_document_update: "workflow_document_update";
    }>;
    status: z.ZodEnum<{
      archived: "archived";
      failed: "failed";
      merged: "merged";
      pending: "pending";
    }>;
    targetRecordId: z.ZodNullable<z.ZodString>;
    targetViewId: z.ZodNullable<z.ZodString>;
    filePath: z.ZodNullable<z.ZodString>;
    sourceRecordId: z.ZodNullable<z.ZodString>;
    sourceCommitId: z.ZodNullable<z.ZodString>;
    baseCommitId: z.ZodNullable<z.ZodString>;
    headCommitId: z.ZodString;
    deleteMode: z.ZodEnum<{
      archive: "archive";
    }>;
    mergedRecordId: z.ZodNullable<z.ZodString>;
    mergedViewId: z.ZodNullable<z.ZodString>;
    position: z.ZodNumber;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    headCommit: z.ZodObject<
      {
        id: z.ZodString;
        baseId: z.ZodNullable<z.ZodString>;
        targetType: z.ZodEnum<{
          base: "base";
          node: "node";
        }>;
        nodeId: z.ZodNullable<z.ZodString>;
        operationId: z.ZodNullable<z.ZodString>;
        parentCommitId: z.ZodNullable<z.ZodString>;
        payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        operation: z.ZodEnum<{
          [x: `${string}_file_create`]: `${string}_file_create`;
          [x: `${string}_file_delete`]: `${string}_file_delete`;
          [x: `${string}_file_update`]: `${string}_file_update`;
          [x: `${string}_metadata_update`]: `${string}_metadata_update`;
          base_add_field: "base_add_field";
          base_archive: "base_archive";
          base_convert_field: "base_convert_field";
          base_delete_field: "base_delete_field";
          base_reorder_fields: "base_reorder_fields";
          base_restore: "base_restore";
          base_restore_field: "base_restore_field";
          base_update_field: "base_update_field";
          doc_update: "doc_update";
          html_document_update: "html_document_update";
          node_create: "node_create";
          node_delete: "node_delete";
          node_move: "node_move";
          node_rename: "node_rename";
          node_restore: "node_restore";
          record_create: "record_create";
          record_delete: "record_delete";
          record_restore: "record_restore";
          record_update: "record_update";
          record_variant: "record_variant";
          view_create: "view_create";
          view_delete: "view_delete";
          view_restore: "view_restore";
          view_update: "view_update";
          whiteboard_document_update: "whiteboard_document_update";
          workflow_document_update: "workflow_document_update";
        }>;
        message: z.ZodString;
        author: z.ZodString;
        authorUser: z.ZodDefault<
          z.ZodOptional<
            z.ZodNullable<
              z.ZodObject<
                {
                  id: z.ZodString;
                  name: z.ZodNullable<z.ZodString>;
                  email: z.ZodNullable<z.ZodString>;
                  image: z.ZodNullable<z.ZodString>;
                  role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                },
                z.core.$strip
              >
            >
          >
        >;
        createdAt: z.ZodString;
      },
      z.core.$strip
    >;
    baseFields: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  },
  z.core.$strip
>;
declare const reviewSchema: z.ZodObject<
  {
    id: z.ZodString;
    changeRequestId: z.ZodString;
    reviewerId: z.ZodString;
    reviewer: z.ZodDefault<
      z.ZodOptional<
        z.ZodNullable<
          z.ZodObject<
            {
              id: z.ZodString;
              name: z.ZodNullable<z.ZodString>;
              email: z.ZodNullable<z.ZodString>;
              image: z.ZodNullable<z.ZodString>;
              role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            },
            z.core.$strip
          >
        >
      >
    >;
    verdict: z.ZodEnum<{
      approved: "approved";
      rejected: "rejected";
    }>;
    reason: z.ZodNullable<z.ZodString>;
    visibleOperationHeads: z.ZodRecord<z.ZodString, z.ZodString>;
    createdAt: z.ZodString;
  },
  z.core.$strip
>;
declare const commentSubjectTypeSchema: z.ZodEnum<{
  change_request: "change_request";
  commit: "commit";
  operation: "operation";
  record: "record";
}>;
declare const commentSchema: z.ZodObject<
  {
    id: z.ZodString;
    subjectType: z.ZodEnum<{
      change_request: "change_request";
      commit: "commit";
      operation: "operation";
      record: "record";
    }>;
    subjectId: z.ZodString;
    recordId: z.ZodNullable<z.ZodString>;
    changeRequestId: z.ZodNullable<z.ZodString>;
    operationId: z.ZodNullable<z.ZodString>;
    commitId: z.ZodNullable<z.ZodString>;
    authorId: z.ZodString;
    author: z.ZodDefault<
      z.ZodOptional<
        z.ZodNullable<
          z.ZodObject<
            {
              id: z.ZodString;
              name: z.ZodNullable<z.ZodString>;
              email: z.ZodNullable<z.ZodString>;
              image: z.ZodNullable<z.ZodString>;
              role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            },
            z.core.$strip
          >
        >
      >
    >;
    body: z.ZodString;
    mentionsAi: z.ZodBoolean;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
  },
  z.core.$strip
>;
declare const changeRequestStatusSchema: z.ZodEnum<{
  abandoned: "abandoned";
  approved: "approved";
  changes_requested: "changes_requested";
  conflict: "conflict";
  in_review: "in_review";
  merged: "merged";
  rejected: "rejected";
}>;
declare const changeRequestSchema: z.ZodObject<
  {
    id: z.ZodString;
    baseId: z.ZodNullable<z.ZodString>;
    targetType: z.ZodEnum<{
      base: "base";
      node: "node";
    }>;
    nodeId: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<{
      abandoned: "abandoned";
      approved: "approved";
      changes_requested: "changes_requested";
      conflict: "conflict";
      in_review: "in_review";
      merged: "merged";
      rejected: "rejected";
    }>;
    submittedBy: z.ZodString;
    submittedByUser: z.ZodDefault<
      z.ZodOptional<
        z.ZodNullable<
          z.ZodObject<
            {
              id: z.ZodString;
              name: z.ZodNullable<z.ZodString>;
              email: z.ZodNullable<z.ZodString>;
              image: z.ZodNullable<z.ZodString>;
              role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            },
            z.core.$strip
          >
        >
      >
    >;
    sourceMeta: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    reviewPolicySnapshot: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    mergeSummary: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    rejectedReason: z.ZodNullable<z.ZodString>;
    reviewedAt: z.ZodNullable<z.ZodString>;
    mergedAt: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    base: z.ZodNullable<
      z.ZodObject<
        {
          id: z.ZodString;
          nodeId: z.ZodString;
          slug: z.ZodString;
          name: z.ZodString;
          description: z.ZodString;
          reviewPolicy: z.ZodObject<
            {
              kind: z.ZodLiteral<"single">;
              requiredApprovals: z.ZodNumber;
            },
            z.core.$strip
          >;
          createdAt: z.ZodString;
          fields: z.ZodArray<
            z.ZodObject<
              {
                id: z.ZodString;
                baseId: z.ZodString;
                slug: z.ZodString;
                name: z.ZodUnion<
                  readonly [
                    z.ZodString,
                    z.ZodRecord<
                      z.ZodEnum<{
                        de: "de";
                        en: "en";
                        es: "es";
                        fr: "fr";
                        ja: "ja";
                        ko: "ko";
                        pt: "pt";
                        "zh-CN": "zh-CN";
                        "zh-TW": "zh-TW";
                      }> &
                        z.core.$partial,
                      z.ZodString
                    >,
                  ]
                >;
                type: z.ZodEnum<{
                  ai_summary: "ai_summary";
                  ai_tags: "ai_tags";
                  attachment: "attachment";
                  auto_number: "auto_number";
                  checkbox: "checkbox";
                  code: "code";
                  created_by: "created_by";
                  created_time: "created_time";
                  date: "date";
                  email: "email";
                  embed: "embed";
                  formula: "formula";
                  html: "html";
                  json: "json";
                  longtext: "longtext";
                  lookup: "lookup";
                  markdown: "markdown";
                  multiselect: "multiselect";
                  number: "number";
                  phone: "phone";
                  relation: "relation";
                  select: "select";
                  text: "text";
                  updated_by: "updated_by";
                  updated_time: "updated_time";
                  url: "url";
                  whiteboard: "whiteboard";
                  yaml: "yaml";
                }>;
                required: z.ZodBoolean;
                position: z.ZodNumber;
                options: z.ZodDefault<
                  z.ZodObject<
                    {
                      ai: z.ZodOptional<
                        z.ZodObject<
                          {
                            model: z.ZodOptional<z.ZodString>;
                            prompt: z.ZodOptional<z.ZodString>;
                            reviewRequired: z.ZodOptional<z.ZodBoolean>;
                            sourceFieldIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                          },
                          z.core.$strip
                        >
                      >;
                      attachment: z.ZodOptional<
                        z.ZodObject<
                          {
                            maxFiles: z.ZodOptional<z.ZodNumber>;
                            allowedMimeTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
                            maxFileSize: z.ZodOptional<z.ZodNumber>;
                          },
                          z.core.$strip
                        >
                      >;
                      choices: z.ZodOptional<
                        z.ZodArray<
                          z.ZodObject<
                            {
                              color: z.ZodOptional<z.ZodString>;
                              id: z.ZodString;
                              name: z.ZodString;
                            },
                            z.core.$strip
                          >
                        >
                      >;
                      code: z.ZodOptional<
                        z.ZodObject<
                          {
                            language: z.ZodOptional<z.ZodString>;
                          },
                          z.core.$strip
                        >
                      >;
                      embed: z.ZodOptional<
                        z.ZodObject<
                          {
                            aspectRatio: z.ZodOptional<
                              z.ZodEnum<{
                                "16:9": "16:9";
                                "1:1": "1:1";
                                "4:3": "4:3";
                              }>
                            >;
                            height: z.ZodOptional<z.ZodNumber>;
                            providers: z.ZodOptional<z.ZodArray<z.ZodString>>;
                          },
                          z.core.$strip
                        >
                      >;
                      formula: z.ZodOptional<
                        z.ZodObject<
                          {
                            expression: z.ZodString;
                          },
                          z.core.$strip
                        >
                      >;
                      inverseFieldId: z.ZodOptional<z.ZodString>;
                      lookup: z.ZodOptional<
                        z.ZodObject<
                          {
                            relationFieldSlug: z.ZodString;
                            targetFieldSlug: z.ZodString;
                            rollup: z.ZodOptional<
                              z.ZodDefault<
                                z.ZodEnum<{
                                  average: "average";
                                  concatenate: "concatenate";
                                  count: "count";
                                  max: "max";
                                  min: "min";
                                  sum: "sum";
                                  values: "values";
                                }>
                              >
                            >;
                            limit: z.ZodOptional<
                              z.ZodEnum<{
                                all: "all";
                                first: "first";
                              }>
                            >;
                          },
                          z.core.$strip
                        >
                      >;
                      multiple: z.ZodOptional<z.ZodBoolean>;
                      number: z.ZodOptional<
                        z.ZodObject<
                          {
                            format: z.ZodOptional<
                              z.ZodEnum<{
                                currency: "currency";
                                plain: "plain";
                              }>
                            >;
                            currency: z.ZodOptional<z.ZodString>;
                            locale: z.ZodOptional<z.ZodString>;
                          },
                          z.core.$strip
                        >
                      >;
                      targetBaseId: z.ZodOptional<z.ZodString>;
                      targetBaseSlug: z.ZodOptional<z.ZodString>;
                    },
                    z.core.$strip
                  >
                >;
              },
              z.core.$strip
            >
          >;
        },
        z.core.$strip
      >
    >;
    node: z.ZodNullable<
      z.ZodType<NodeOutput, unknown, z.core.$ZodTypeInternals<NodeOutput, unknown>>
    >;
    operations: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          changeRequestId: z.ZodString;
          baseId: z.ZodNullable<z.ZodString>;
          targetType: z.ZodEnum<{
            base: "base";
            node: "node";
          }>;
          nodeId: z.ZodNullable<z.ZodString>;
          operation: z.ZodEnum<{
            [x: `${string}_file_create`]: `${string}_file_create`;
            [x: `${string}_file_delete`]: `${string}_file_delete`;
            [x: `${string}_file_update`]: `${string}_file_update`;
            [x: `${string}_metadata_update`]: `${string}_metadata_update`;
            base_add_field: "base_add_field";
            base_archive: "base_archive";
            base_convert_field: "base_convert_field";
            base_delete_field: "base_delete_field";
            base_reorder_fields: "base_reorder_fields";
            base_restore: "base_restore";
            base_restore_field: "base_restore_field";
            base_update_field: "base_update_field";
            doc_update: "doc_update";
            html_document_update: "html_document_update";
            node_create: "node_create";
            node_delete: "node_delete";
            node_move: "node_move";
            node_rename: "node_rename";
            node_restore: "node_restore";
            record_create: "record_create";
            record_delete: "record_delete";
            record_restore: "record_restore";
            record_update: "record_update";
            record_variant: "record_variant";
            view_create: "view_create";
            view_delete: "view_delete";
            view_restore: "view_restore";
            view_update: "view_update";
            whiteboard_document_update: "whiteboard_document_update";
            workflow_document_update: "workflow_document_update";
          }>;
          status: z.ZodEnum<{
            archived: "archived";
            failed: "failed";
            merged: "merged";
            pending: "pending";
          }>;
          targetRecordId: z.ZodNullable<z.ZodString>;
          targetViewId: z.ZodNullable<z.ZodString>;
          filePath: z.ZodNullable<z.ZodString>;
          sourceRecordId: z.ZodNullable<z.ZodString>;
          sourceCommitId: z.ZodNullable<z.ZodString>;
          baseCommitId: z.ZodNullable<z.ZodString>;
          headCommitId: z.ZodString;
          deleteMode: z.ZodEnum<{
            archive: "archive";
          }>;
          mergedRecordId: z.ZodNullable<z.ZodString>;
          mergedViewId: z.ZodNullable<z.ZodString>;
          position: z.ZodNumber;
          createdAt: z.ZodString;
          updatedAt: z.ZodString;
          headCommit: z.ZodObject<
            {
              id: z.ZodString;
              baseId: z.ZodNullable<z.ZodString>;
              targetType: z.ZodEnum<{
                base: "base";
                node: "node";
              }>;
              nodeId: z.ZodNullable<z.ZodString>;
              operationId: z.ZodNullable<z.ZodString>;
              parentCommitId: z.ZodNullable<z.ZodString>;
              payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
              operation: z.ZodEnum<{
                [x: `${string}_file_create`]: `${string}_file_create`;
                [x: `${string}_file_delete`]: `${string}_file_delete`;
                [x: `${string}_file_update`]: `${string}_file_update`;
                [x: `${string}_metadata_update`]: `${string}_metadata_update`;
                base_add_field: "base_add_field";
                base_archive: "base_archive";
                base_convert_field: "base_convert_field";
                base_delete_field: "base_delete_field";
                base_reorder_fields: "base_reorder_fields";
                base_restore: "base_restore";
                base_restore_field: "base_restore_field";
                base_update_field: "base_update_field";
                doc_update: "doc_update";
                html_document_update: "html_document_update";
                node_create: "node_create";
                node_delete: "node_delete";
                node_move: "node_move";
                node_rename: "node_rename";
                node_restore: "node_restore";
                record_create: "record_create";
                record_delete: "record_delete";
                record_restore: "record_restore";
                record_update: "record_update";
                record_variant: "record_variant";
                view_create: "view_create";
                view_delete: "view_delete";
                view_restore: "view_restore";
                view_update: "view_update";
                whiteboard_document_update: "whiteboard_document_update";
                workflow_document_update: "workflow_document_update";
              }>;
              message: z.ZodString;
              author: z.ZodString;
              authorUser: z.ZodDefault<
                z.ZodOptional<
                  z.ZodNullable<
                    z.ZodObject<
                      {
                        id: z.ZodString;
                        name: z.ZodNullable<z.ZodString>;
                        email: z.ZodNullable<z.ZodString>;
                        image: z.ZodNullable<z.ZodString>;
                        role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                      },
                      z.core.$strip
                    >
                  >
                >
              >;
              createdAt: z.ZodString;
            },
            z.core.$strip
          >;
          baseFields: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        },
        z.core.$strip
      >
    >;
    primaryOperation: z.ZodNullable<
      z.ZodObject<
        {
          id: z.ZodString;
          changeRequestId: z.ZodString;
          baseId: z.ZodNullable<z.ZodString>;
          targetType: z.ZodEnum<{
            base: "base";
            node: "node";
          }>;
          nodeId: z.ZodNullable<z.ZodString>;
          operation: z.ZodEnum<{
            [x: `${string}_file_create`]: `${string}_file_create`;
            [x: `${string}_file_delete`]: `${string}_file_delete`;
            [x: `${string}_file_update`]: `${string}_file_update`;
            [x: `${string}_metadata_update`]: `${string}_metadata_update`;
            base_add_field: "base_add_field";
            base_archive: "base_archive";
            base_convert_field: "base_convert_field";
            base_delete_field: "base_delete_field";
            base_reorder_fields: "base_reorder_fields";
            base_restore: "base_restore";
            base_restore_field: "base_restore_field";
            base_update_field: "base_update_field";
            doc_update: "doc_update";
            html_document_update: "html_document_update";
            node_create: "node_create";
            node_delete: "node_delete";
            node_move: "node_move";
            node_rename: "node_rename";
            node_restore: "node_restore";
            record_create: "record_create";
            record_delete: "record_delete";
            record_restore: "record_restore";
            record_update: "record_update";
            record_variant: "record_variant";
            view_create: "view_create";
            view_delete: "view_delete";
            view_restore: "view_restore";
            view_update: "view_update";
            whiteboard_document_update: "whiteboard_document_update";
            workflow_document_update: "workflow_document_update";
          }>;
          status: z.ZodEnum<{
            archived: "archived";
            failed: "failed";
            merged: "merged";
            pending: "pending";
          }>;
          targetRecordId: z.ZodNullable<z.ZodString>;
          targetViewId: z.ZodNullable<z.ZodString>;
          filePath: z.ZodNullable<z.ZodString>;
          sourceRecordId: z.ZodNullable<z.ZodString>;
          sourceCommitId: z.ZodNullable<z.ZodString>;
          baseCommitId: z.ZodNullable<z.ZodString>;
          headCommitId: z.ZodString;
          deleteMode: z.ZodEnum<{
            archive: "archive";
          }>;
          mergedRecordId: z.ZodNullable<z.ZodString>;
          mergedViewId: z.ZodNullable<z.ZodString>;
          position: z.ZodNumber;
          createdAt: z.ZodString;
          updatedAt: z.ZodString;
          headCommit: z.ZodObject<
            {
              id: z.ZodString;
              baseId: z.ZodNullable<z.ZodString>;
              targetType: z.ZodEnum<{
                base: "base";
                node: "node";
              }>;
              nodeId: z.ZodNullable<z.ZodString>;
              operationId: z.ZodNullable<z.ZodString>;
              parentCommitId: z.ZodNullable<z.ZodString>;
              payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
              operation: z.ZodEnum<{
                [x: `${string}_file_create`]: `${string}_file_create`;
                [x: `${string}_file_delete`]: `${string}_file_delete`;
                [x: `${string}_file_update`]: `${string}_file_update`;
                [x: `${string}_metadata_update`]: `${string}_metadata_update`;
                base_add_field: "base_add_field";
                base_archive: "base_archive";
                base_convert_field: "base_convert_field";
                base_delete_field: "base_delete_field";
                base_reorder_fields: "base_reorder_fields";
                base_restore: "base_restore";
                base_restore_field: "base_restore_field";
                base_update_field: "base_update_field";
                doc_update: "doc_update";
                html_document_update: "html_document_update";
                node_create: "node_create";
                node_delete: "node_delete";
                node_move: "node_move";
                node_rename: "node_rename";
                node_restore: "node_restore";
                record_create: "record_create";
                record_delete: "record_delete";
                record_restore: "record_restore";
                record_update: "record_update";
                record_variant: "record_variant";
                view_create: "view_create";
                view_delete: "view_delete";
                view_restore: "view_restore";
                view_update: "view_update";
                whiteboard_document_update: "whiteboard_document_update";
                workflow_document_update: "workflow_document_update";
              }>;
              message: z.ZodString;
              author: z.ZodString;
              authorUser: z.ZodDefault<
                z.ZodOptional<
                  z.ZodNullable<
                    z.ZodObject<
                      {
                        id: z.ZodString;
                        name: z.ZodNullable<z.ZodString>;
                        email: z.ZodNullable<z.ZodString>;
                        image: z.ZodNullable<z.ZodString>;
                        role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                      },
                      z.core.$strip
                    >
                  >
                >
              >;
              createdAt: z.ZodString;
            },
            z.core.$strip
          >;
          baseFields: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        },
        z.core.$strip
      >
    >;
    operationCount: z.ZodNumber;
    reviews: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          changeRequestId: z.ZodString;
          reviewerId: z.ZodString;
          reviewer: z.ZodDefault<
            z.ZodOptional<
              z.ZodNullable<
                z.ZodObject<
                  {
                    id: z.ZodString;
                    name: z.ZodNullable<z.ZodString>;
                    email: z.ZodNullable<z.ZodString>;
                    image: z.ZodNullable<z.ZodString>;
                    role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                  },
                  z.core.$strip
                >
              >
            >
          >;
          verdict: z.ZodEnum<{
            approved: "approved";
            rejected: "rejected";
          }>;
          reason: z.ZodNullable<z.ZodString>;
          visibleOperationHeads: z.ZodRecord<z.ZodString, z.ZodString>;
          createdAt: z.ZodString;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
declare const agentTaskSchema: z.ZodObject<
  {
    changeRequest: z.ZodObject<
      {
        id: z.ZodString;
        baseId: z.ZodNullable<z.ZodString>;
        targetType: z.ZodEnum<{
          base: "base";
          node: "node";
        }>;
        nodeId: z.ZodNullable<z.ZodString>;
        status: z.ZodEnum<{
          abandoned: "abandoned";
          approved: "approved";
          changes_requested: "changes_requested";
          conflict: "conflict";
          in_review: "in_review";
          merged: "merged";
          rejected: "rejected";
        }>;
        submittedBy: z.ZodString;
        submittedByUser: z.ZodDefault<
          z.ZodOptional<
            z.ZodNullable<
              z.ZodObject<
                {
                  id: z.ZodString;
                  name: z.ZodNullable<z.ZodString>;
                  email: z.ZodNullable<z.ZodString>;
                  image: z.ZodNullable<z.ZodString>;
                  role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                },
                z.core.$strip
              >
            >
          >
        >;
        sourceMeta: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        reviewPolicySnapshot: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        mergeSummary: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        rejectedReason: z.ZodNullable<z.ZodString>;
        reviewedAt: z.ZodNullable<z.ZodString>;
        mergedAt: z.ZodNullable<z.ZodString>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        base: z.ZodNullable<
          z.ZodObject<
            {
              id: z.ZodString;
              nodeId: z.ZodString;
              slug: z.ZodString;
              name: z.ZodString;
              description: z.ZodString;
              reviewPolicy: z.ZodObject<
                {
                  kind: z.ZodLiteral<"single">;
                  requiredApprovals: z.ZodNumber;
                },
                z.core.$strip
              >;
              createdAt: z.ZodString;
              fields: z.ZodArray<
                z.ZodObject<
                  {
                    id: z.ZodString;
                    baseId: z.ZodString;
                    slug: z.ZodString;
                    name: z.ZodUnion<
                      readonly [
                        z.ZodString,
                        z.ZodRecord<
                          z.ZodEnum<{
                            de: "de";
                            en: "en";
                            es: "es";
                            fr: "fr";
                            ja: "ja";
                            ko: "ko";
                            pt: "pt";
                            "zh-CN": "zh-CN";
                            "zh-TW": "zh-TW";
                          }> &
                            z.core.$partial,
                          z.ZodString
                        >,
                      ]
                    >;
                    type: z.ZodEnum<{
                      ai_summary: "ai_summary";
                      ai_tags: "ai_tags";
                      attachment: "attachment";
                      auto_number: "auto_number";
                      checkbox: "checkbox";
                      code: "code";
                      created_by: "created_by";
                      created_time: "created_time";
                      date: "date";
                      email: "email";
                      embed: "embed";
                      formula: "formula";
                      html: "html";
                      json: "json";
                      longtext: "longtext";
                      lookup: "lookup";
                      markdown: "markdown";
                      multiselect: "multiselect";
                      number: "number";
                      phone: "phone";
                      relation: "relation";
                      select: "select";
                      text: "text";
                      updated_by: "updated_by";
                      updated_time: "updated_time";
                      url: "url";
                      whiteboard: "whiteboard";
                      yaml: "yaml";
                    }>;
                    required: z.ZodBoolean;
                    position: z.ZodNumber;
                    options: z.ZodDefault<
                      z.ZodObject<
                        {
                          ai: z.ZodOptional<
                            z.ZodObject<
                              {
                                model: z.ZodOptional<z.ZodString>;
                                prompt: z.ZodOptional<z.ZodString>;
                                reviewRequired: z.ZodOptional<z.ZodBoolean>;
                                sourceFieldIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                              },
                              z.core.$strip
                            >
                          >;
                          attachment: z.ZodOptional<
                            z.ZodObject<
                              {
                                maxFiles: z.ZodOptional<z.ZodNumber>;
                                allowedMimeTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
                                maxFileSize: z.ZodOptional<z.ZodNumber>;
                              },
                              z.core.$strip
                            >
                          >;
                          choices: z.ZodOptional<
                            z.ZodArray<
                              z.ZodObject<
                                {
                                  color: z.ZodOptional<z.ZodString>;
                                  id: z.ZodString;
                                  name: z.ZodString;
                                },
                                z.core.$strip
                              >
                            >
                          >;
                          code: z.ZodOptional<
                            z.ZodObject<
                              {
                                language: z.ZodOptional<z.ZodString>;
                              },
                              z.core.$strip
                            >
                          >;
                          embed: z.ZodOptional<
                            z.ZodObject<
                              {
                                aspectRatio: z.ZodOptional<
                                  z.ZodEnum<{
                                    "16:9": "16:9";
                                    "1:1": "1:1";
                                    "4:3": "4:3";
                                  }>
                                >;
                                height: z.ZodOptional<z.ZodNumber>;
                                providers: z.ZodOptional<z.ZodArray<z.ZodString>>;
                              },
                              z.core.$strip
                            >
                          >;
                          formula: z.ZodOptional<
                            z.ZodObject<
                              {
                                expression: z.ZodString;
                              },
                              z.core.$strip
                            >
                          >;
                          inverseFieldId: z.ZodOptional<z.ZodString>;
                          lookup: z.ZodOptional<
                            z.ZodObject<
                              {
                                relationFieldSlug: z.ZodString;
                                targetFieldSlug: z.ZodString;
                                rollup: z.ZodOptional<
                                  z.ZodDefault<
                                    z.ZodEnum<{
                                      average: "average";
                                      concatenate: "concatenate";
                                      count: "count";
                                      max: "max";
                                      min: "min";
                                      sum: "sum";
                                      values: "values";
                                    }>
                                  >
                                >;
                                limit: z.ZodOptional<
                                  z.ZodEnum<{
                                    all: "all";
                                    first: "first";
                                  }>
                                >;
                              },
                              z.core.$strip
                            >
                          >;
                          multiple: z.ZodOptional<z.ZodBoolean>;
                          number: z.ZodOptional<
                            z.ZodObject<
                              {
                                format: z.ZodOptional<
                                  z.ZodEnum<{
                                    currency: "currency";
                                    plain: "plain";
                                  }>
                                >;
                                currency: z.ZodOptional<z.ZodString>;
                                locale: z.ZodOptional<z.ZodString>;
                              },
                              z.core.$strip
                            >
                          >;
                          targetBaseId: z.ZodOptional<z.ZodString>;
                          targetBaseSlug: z.ZodOptional<z.ZodString>;
                        },
                        z.core.$strip
                      >
                    >;
                  },
                  z.core.$strip
                >
              >;
            },
            z.core.$strip
          >
        >;
        node: z.ZodNullable<
          z.ZodType<NodeOutput, unknown, z.core.$ZodTypeInternals<NodeOutput, unknown>>
        >;
        operations: z.ZodArray<
          z.ZodObject<
            {
              id: z.ZodString;
              changeRequestId: z.ZodString;
              baseId: z.ZodNullable<z.ZodString>;
              targetType: z.ZodEnum<{
                base: "base";
                node: "node";
              }>;
              nodeId: z.ZodNullable<z.ZodString>;
              operation: z.ZodEnum<{
                [x: `${string}_file_create`]: `${string}_file_create`;
                [x: `${string}_file_delete`]: `${string}_file_delete`;
                [x: `${string}_file_update`]: `${string}_file_update`;
                [x: `${string}_metadata_update`]: `${string}_metadata_update`;
                base_add_field: "base_add_field";
                base_archive: "base_archive";
                base_convert_field: "base_convert_field";
                base_delete_field: "base_delete_field";
                base_reorder_fields: "base_reorder_fields";
                base_restore: "base_restore";
                base_restore_field: "base_restore_field";
                base_update_field: "base_update_field";
                doc_update: "doc_update";
                html_document_update: "html_document_update";
                node_create: "node_create";
                node_delete: "node_delete";
                node_move: "node_move";
                node_rename: "node_rename";
                node_restore: "node_restore";
                record_create: "record_create";
                record_delete: "record_delete";
                record_restore: "record_restore";
                record_update: "record_update";
                record_variant: "record_variant";
                view_create: "view_create";
                view_delete: "view_delete";
                view_restore: "view_restore";
                view_update: "view_update";
                whiteboard_document_update: "whiteboard_document_update";
                workflow_document_update: "workflow_document_update";
              }>;
              status: z.ZodEnum<{
                archived: "archived";
                failed: "failed";
                merged: "merged";
                pending: "pending";
              }>;
              targetRecordId: z.ZodNullable<z.ZodString>;
              targetViewId: z.ZodNullable<z.ZodString>;
              filePath: z.ZodNullable<z.ZodString>;
              sourceRecordId: z.ZodNullable<z.ZodString>;
              sourceCommitId: z.ZodNullable<z.ZodString>;
              baseCommitId: z.ZodNullable<z.ZodString>;
              headCommitId: z.ZodString;
              deleteMode: z.ZodEnum<{
                archive: "archive";
              }>;
              mergedRecordId: z.ZodNullable<z.ZodString>;
              mergedViewId: z.ZodNullable<z.ZodString>;
              position: z.ZodNumber;
              createdAt: z.ZodString;
              updatedAt: z.ZodString;
              headCommit: z.ZodObject<
                {
                  id: z.ZodString;
                  baseId: z.ZodNullable<z.ZodString>;
                  targetType: z.ZodEnum<{
                    base: "base";
                    node: "node";
                  }>;
                  nodeId: z.ZodNullable<z.ZodString>;
                  operationId: z.ZodNullable<z.ZodString>;
                  parentCommitId: z.ZodNullable<z.ZodString>;
                  payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
                  operation: z.ZodEnum<{
                    [x: `${string}_file_create`]: `${string}_file_create`;
                    [x: `${string}_file_delete`]: `${string}_file_delete`;
                    [x: `${string}_file_update`]: `${string}_file_update`;
                    [x: `${string}_metadata_update`]: `${string}_metadata_update`;
                    base_add_field: "base_add_field";
                    base_archive: "base_archive";
                    base_convert_field: "base_convert_field";
                    base_delete_field: "base_delete_field";
                    base_reorder_fields: "base_reorder_fields";
                    base_restore: "base_restore";
                    base_restore_field: "base_restore_field";
                    base_update_field: "base_update_field";
                    doc_update: "doc_update";
                    html_document_update: "html_document_update";
                    node_create: "node_create";
                    node_delete: "node_delete";
                    node_move: "node_move";
                    node_rename: "node_rename";
                    node_restore: "node_restore";
                    record_create: "record_create";
                    record_delete: "record_delete";
                    record_restore: "record_restore";
                    record_update: "record_update";
                    record_variant: "record_variant";
                    view_create: "view_create";
                    view_delete: "view_delete";
                    view_restore: "view_restore";
                    view_update: "view_update";
                    whiteboard_document_update: "whiteboard_document_update";
                    workflow_document_update: "workflow_document_update";
                  }>;
                  message: z.ZodString;
                  author: z.ZodString;
                  authorUser: z.ZodDefault<
                    z.ZodOptional<
                      z.ZodNullable<
                        z.ZodObject<
                          {
                            id: z.ZodString;
                            name: z.ZodNullable<z.ZodString>;
                            email: z.ZodNullable<z.ZodString>;
                            image: z.ZodNullable<z.ZodString>;
                            role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                          },
                          z.core.$strip
                        >
                      >
                    >
                  >;
                  createdAt: z.ZodString;
                },
                z.core.$strip
              >;
              baseFields: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            },
            z.core.$strip
          >
        >;
        primaryOperation: z.ZodNullable<
          z.ZodObject<
            {
              id: z.ZodString;
              changeRequestId: z.ZodString;
              baseId: z.ZodNullable<z.ZodString>;
              targetType: z.ZodEnum<{
                base: "base";
                node: "node";
              }>;
              nodeId: z.ZodNullable<z.ZodString>;
              operation: z.ZodEnum<{
                [x: `${string}_file_create`]: `${string}_file_create`;
                [x: `${string}_file_delete`]: `${string}_file_delete`;
                [x: `${string}_file_update`]: `${string}_file_update`;
                [x: `${string}_metadata_update`]: `${string}_metadata_update`;
                base_add_field: "base_add_field";
                base_archive: "base_archive";
                base_convert_field: "base_convert_field";
                base_delete_field: "base_delete_field";
                base_reorder_fields: "base_reorder_fields";
                base_restore: "base_restore";
                base_restore_field: "base_restore_field";
                base_update_field: "base_update_field";
                doc_update: "doc_update";
                html_document_update: "html_document_update";
                node_create: "node_create";
                node_delete: "node_delete";
                node_move: "node_move";
                node_rename: "node_rename";
                node_restore: "node_restore";
                record_create: "record_create";
                record_delete: "record_delete";
                record_restore: "record_restore";
                record_update: "record_update";
                record_variant: "record_variant";
                view_create: "view_create";
                view_delete: "view_delete";
                view_restore: "view_restore";
                view_update: "view_update";
                whiteboard_document_update: "whiteboard_document_update";
                workflow_document_update: "workflow_document_update";
              }>;
              status: z.ZodEnum<{
                archived: "archived";
                failed: "failed";
                merged: "merged";
                pending: "pending";
              }>;
              targetRecordId: z.ZodNullable<z.ZodString>;
              targetViewId: z.ZodNullable<z.ZodString>;
              filePath: z.ZodNullable<z.ZodString>;
              sourceRecordId: z.ZodNullable<z.ZodString>;
              sourceCommitId: z.ZodNullable<z.ZodString>;
              baseCommitId: z.ZodNullable<z.ZodString>;
              headCommitId: z.ZodString;
              deleteMode: z.ZodEnum<{
                archive: "archive";
              }>;
              mergedRecordId: z.ZodNullable<z.ZodString>;
              mergedViewId: z.ZodNullable<z.ZodString>;
              position: z.ZodNumber;
              createdAt: z.ZodString;
              updatedAt: z.ZodString;
              headCommit: z.ZodObject<
                {
                  id: z.ZodString;
                  baseId: z.ZodNullable<z.ZodString>;
                  targetType: z.ZodEnum<{
                    base: "base";
                    node: "node";
                  }>;
                  nodeId: z.ZodNullable<z.ZodString>;
                  operationId: z.ZodNullable<z.ZodString>;
                  parentCommitId: z.ZodNullable<z.ZodString>;
                  payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
                  operation: z.ZodEnum<{
                    [x: `${string}_file_create`]: `${string}_file_create`;
                    [x: `${string}_file_delete`]: `${string}_file_delete`;
                    [x: `${string}_file_update`]: `${string}_file_update`;
                    [x: `${string}_metadata_update`]: `${string}_metadata_update`;
                    base_add_field: "base_add_field";
                    base_archive: "base_archive";
                    base_convert_field: "base_convert_field";
                    base_delete_field: "base_delete_field";
                    base_reorder_fields: "base_reorder_fields";
                    base_restore: "base_restore";
                    base_restore_field: "base_restore_field";
                    base_update_field: "base_update_field";
                    doc_update: "doc_update";
                    html_document_update: "html_document_update";
                    node_create: "node_create";
                    node_delete: "node_delete";
                    node_move: "node_move";
                    node_rename: "node_rename";
                    node_restore: "node_restore";
                    record_create: "record_create";
                    record_delete: "record_delete";
                    record_restore: "record_restore";
                    record_update: "record_update";
                    record_variant: "record_variant";
                    view_create: "view_create";
                    view_delete: "view_delete";
                    view_restore: "view_restore";
                    view_update: "view_update";
                    whiteboard_document_update: "whiteboard_document_update";
                    workflow_document_update: "workflow_document_update";
                  }>;
                  message: z.ZodString;
                  author: z.ZodString;
                  authorUser: z.ZodDefault<
                    z.ZodOptional<
                      z.ZodNullable<
                        z.ZodObject<
                          {
                            id: z.ZodString;
                            name: z.ZodNullable<z.ZodString>;
                            email: z.ZodNullable<z.ZodString>;
                            image: z.ZodNullable<z.ZodString>;
                            role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                          },
                          z.core.$strip
                        >
                      >
                    >
                  >;
                  createdAt: z.ZodString;
                },
                z.core.$strip
              >;
              baseFields: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            },
            z.core.$strip
          >
        >;
        operationCount: z.ZodNumber;
        reviews: z.ZodArray<
          z.ZodObject<
            {
              id: z.ZodString;
              changeRequestId: z.ZodString;
              reviewerId: z.ZodString;
              reviewer: z.ZodDefault<
                z.ZodOptional<
                  z.ZodNullable<
                    z.ZodObject<
                      {
                        id: z.ZodString;
                        name: z.ZodNullable<z.ZodString>;
                        email: z.ZodNullable<z.ZodString>;
                        image: z.ZodNullable<z.ZodString>;
                        role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                      },
                      z.core.$strip
                    >
                  >
                >
              >;
              verdict: z.ZodEnum<{
                approved: "approved";
                rejected: "rejected";
              }>;
              reason: z.ZodNullable<z.ZodString>;
              visibleOperationHeads: z.ZodRecord<z.ZodString, z.ZodString>;
              createdAt: z.ZodString;
            },
            z.core.$strip
          >
        >;
      },
      z.core.$strip
    >;
    trigger: z.ZodEnum<{
      ai_mention: "ai_mention";
      changes_requested: "changes_requested";
    }>;
    reviewReason: z.ZodNullable<z.ZodString>;
    aiComments: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          subjectType: z.ZodEnum<{
            change_request: "change_request";
            commit: "commit";
            operation: "operation";
            record: "record";
          }>;
          subjectId: z.ZodString;
          recordId: z.ZodNullable<z.ZodString>;
          changeRequestId: z.ZodNullable<z.ZodString>;
          operationId: z.ZodNullable<z.ZodString>;
          commitId: z.ZodNullable<z.ZodString>;
          authorId: z.ZodString;
          author: z.ZodDefault<
            z.ZodOptional<
              z.ZodNullable<
                z.ZodObject<
                  {
                    id: z.ZodString;
                    name: z.ZodNullable<z.ZodString>;
                    email: z.ZodNullable<z.ZodString>;
                    image: z.ZodNullable<z.ZodString>;
                    role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                  },
                  z.core.$strip
                >
              >
            >
          >;
          body: z.ZodString;
          mentionsAi: z.ZodBoolean;
          createdAt: z.ZodString;
          updatedAt: z.ZodString;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
declare const searchResultSchema: z.ZodObject<
  {
    id: z.ZodString;
    kind: z.ZodEnum<{
      base: "base";
      change_request: "change_request";
      file: "file";
      record: "record";
    }>;
    title: z.ZodString;
    body: z.ZodString;
    eyebrow: z.ZodString;
    href: z.ZodString;
    updatedAt: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
declare const searchResponseSchema: z.ZodObject<
  {
    query: z.ZodString;
    limit: z.ZodNumber;
    offset: z.ZodNumber;
    hasMore: z.ZodBoolean;
    results: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          kind: z.ZodEnum<{
            base: "base";
            change_request: "change_request";
            file: "file";
            record: "record";
          }>;
          title: z.ZodString;
          body: z.ZodString;
          eyebrow: z.ZodString;
          href: z.ZodString;
          updatedAt: z.ZodNullable<z.ZodString>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
declare const liveEventSchema: z.ZodObject<
  {
    kind: z.ZodEnum<{
      "change_request.created": "change_request.created";
      "change_request.deleted": "change_request.deleted";
      "change_request.merged": "change_request.merged";
      "change_request.pending_review": "change_request.pending_review";
      "change_request.reviewed": "change_request.reviewed";
      "change_request.updated": "change_request.updated";
      "node.metadata_updated": "node.metadata_updated";
    }>;
    spaceId: z.ZodString;
    actorId: z.ZodString;
    changeRequestId: z.ZodNullable<z.ZodString>;
    baseId: z.ZodNullable<z.ZodString>;
    nodeIds: z.ZodArray<z.ZodString>;
    recordIds: z.ZodArray<z.ZodString>;
    viewIds: z.ZodArray<z.ZodString>;
    operationCount: z.ZodNumber;
  },
  z.core.$strip
>;
declare const auditActionSchema: z.ZodEnum<{
  "airapp.created": "airapp.created";
  "asset.deleted": "asset.deleted";
  "asset.metadata_updated": "asset.metadata_updated";
  "asset.text_marked_none": "asset.text_marked_none";
  "asset.text_written": "asset.text_written";
  "base.created": "base.created";
  "change_request.created": "change_request.created";
  "change_request.deleted": "change_request.deleted";
  "change_request.merged": "change_request.merged";
  "change_request.reviewed": "change_request.reviewed";
  "change_request.updated": "change_request.updated";
  "doc.created": "doc.created";
  "doc.updated": "doc.updated";
  "drive.created": "drive.created";
  "field.created": "field.created";
  "file.created": "file.created";
  "node.metadata_updated": "node.metadata_updated";
  "node.purged": "node.purged";
  "record.viewed": "record.viewed";
  "skill.created": "skill.created";
}>;
declare const auditEventSchema: z.ZodObject<
  {
    id: z.ZodString;
    action: z.ZodEnum<{
      "airapp.created": "airapp.created";
      "asset.deleted": "asset.deleted";
      "asset.metadata_updated": "asset.metadata_updated";
      "asset.text_marked_none": "asset.text_marked_none";
      "asset.text_written": "asset.text_written";
      "base.created": "base.created";
      "change_request.created": "change_request.created";
      "change_request.deleted": "change_request.deleted";
      "change_request.merged": "change_request.merged";
      "change_request.reviewed": "change_request.reviewed";
      "change_request.updated": "change_request.updated";
      "doc.created": "doc.created";
      "doc.updated": "doc.updated";
      "drive.created": "drive.created";
      "field.created": "field.created";
      "file.created": "file.created";
      "node.metadata_updated": "node.metadata_updated";
      "node.purged": "node.purged";
      "record.viewed": "record.viewed";
      "skill.created": "skill.created";
    }>;
    actorId: z.ZodString;
    actor: z.ZodDefault<
      z.ZodOptional<
        z.ZodNullable<
          z.ZodObject<
            {
              id: z.ZodString;
              name: z.ZodNullable<z.ZodString>;
              email: z.ZodNullable<z.ZodString>;
              image: z.ZodNullable<z.ZodString>;
              role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            },
            z.core.$strip
          >
        >
      >
    >;
    baseId: z.ZodNullable<z.ZodString>;
    recordId: z.ZodNullable<z.ZodString>;
    changeRequestId: z.ZodNullable<z.ZodString>;
    operationId: z.ZodNullable<z.ZodString>;
    commitId: z.ZodNullable<z.ZodString>;
    metadata: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    createdAt: z.ZodString;
  },
  z.core.$strip
>;
declare const createAuditEventInputSchema: z.ZodObject<
  {
    action: z.ZodEnum<{
      "airapp.created": "airapp.created";
      "asset.deleted": "asset.deleted";
      "asset.metadata_updated": "asset.metadata_updated";
      "asset.text_marked_none": "asset.text_marked_none";
      "asset.text_written": "asset.text_written";
      "base.created": "base.created";
      "change_request.created": "change_request.created";
      "change_request.deleted": "change_request.deleted";
      "change_request.merged": "change_request.merged";
      "change_request.reviewed": "change_request.reviewed";
      "change_request.updated": "change_request.updated";
      "doc.created": "doc.created";
      "doc.updated": "doc.updated";
      "drive.created": "drive.created";
      "field.created": "field.created";
      "file.created": "file.created";
      "node.metadata_updated": "node.metadata_updated";
      "node.purged": "node.purged";
      "record.viewed": "record.viewed";
      "skill.created": "skill.created";
    }>;
    actorId: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    baseId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    recordId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    changeRequestId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    operationId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    commitId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    metadata: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
  },
  z.core.$strip
>;
declare const nodeOperationInputSchema: z.ZodDiscriminatedUnion<
  [
    z.ZodObject<
      {
        kind: z.ZodLiteral<"create">;
        ref: z.ZodOptional<z.ZodString>;
        parentNodeId: z.ZodOptional<z.ZodString>;
        parentNodeRef: z.ZodOptional<z.ZodString>;
        nodeType: z.ZodEnum<{
          [x: string]: string;
        }>;
        slug: z.ZodString;
        name: z.ZodString;
        description: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        metadata: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
        fields: z.ZodOptional<
          z.ZodArray<
            z.ZodObject<
              {
                slug: z.ZodString;
                name: z.ZodUnion<
                  readonly [
                    z.ZodString,
                    z.ZodRecord<
                      z.ZodEnum<{
                        de: "de";
                        en: "en";
                        es: "es";
                        fr: "fr";
                        ja: "ja";
                        ko: "ko";
                        pt: "pt";
                        "zh-CN": "zh-CN";
                        "zh-TW": "zh-TW";
                      }> &
                        z.core.$partial,
                      z.ZodString
                    >,
                  ]
                >;
                type: z.ZodDefault<
                  z.ZodEnum<{
                    ai_summary: "ai_summary";
                    ai_tags: "ai_tags";
                    attachment: "attachment";
                    auto_number: "auto_number";
                    checkbox: "checkbox";
                    code: "code";
                    created_by: "created_by";
                    created_time: "created_time";
                    date: "date";
                    email: "email";
                    embed: "embed";
                    formula: "formula";
                    html: "html";
                    json: "json";
                    longtext: "longtext";
                    lookup: "lookup";
                    markdown: "markdown";
                    multiselect: "multiselect";
                    number: "number";
                    phone: "phone";
                    relation: "relation";
                    select: "select";
                    text: "text";
                    updated_by: "updated_by";
                    updated_time: "updated_time";
                    url: "url";
                    whiteboard: "whiteboard";
                    yaml: "yaml";
                  }>
                >;
                required: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
                options: z.ZodDefault<
                  z.ZodOptional<
                    z.ZodDefault<
                      z.ZodObject<
                        {
                          ai: z.ZodOptional<
                            z.ZodObject<
                              {
                                model: z.ZodOptional<z.ZodString>;
                                prompt: z.ZodOptional<z.ZodString>;
                                reviewRequired: z.ZodOptional<z.ZodBoolean>;
                                sourceFieldIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                              },
                              z.core.$strip
                            >
                          >;
                          attachment: z.ZodOptional<
                            z.ZodObject<
                              {
                                maxFiles: z.ZodOptional<z.ZodNumber>;
                                allowedMimeTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
                                maxFileSize: z.ZodOptional<z.ZodNumber>;
                              },
                              z.core.$strip
                            >
                          >;
                          choices: z.ZodOptional<
                            z.ZodArray<
                              z.ZodObject<
                                {
                                  color: z.ZodOptional<z.ZodString>;
                                  id: z.ZodString;
                                  name: z.ZodString;
                                },
                                z.core.$strip
                              >
                            >
                          >;
                          code: z.ZodOptional<
                            z.ZodObject<
                              {
                                language: z.ZodOptional<z.ZodString>;
                              },
                              z.core.$strip
                            >
                          >;
                          embed: z.ZodOptional<
                            z.ZodObject<
                              {
                                aspectRatio: z.ZodOptional<
                                  z.ZodEnum<{
                                    "16:9": "16:9";
                                    "1:1": "1:1";
                                    "4:3": "4:3";
                                  }>
                                >;
                                height: z.ZodOptional<z.ZodNumber>;
                                providers: z.ZodOptional<z.ZodArray<z.ZodString>>;
                              },
                              z.core.$strip
                            >
                          >;
                          formula: z.ZodOptional<
                            z.ZodObject<
                              {
                                expression: z.ZodString;
                              },
                              z.core.$strip
                            >
                          >;
                          inverseFieldId: z.ZodOptional<z.ZodString>;
                          lookup: z.ZodOptional<
                            z.ZodObject<
                              {
                                relationFieldSlug: z.ZodString;
                                targetFieldSlug: z.ZodString;
                                rollup: z.ZodOptional<
                                  z.ZodDefault<
                                    z.ZodEnum<{
                                      average: "average";
                                      concatenate: "concatenate";
                                      count: "count";
                                      max: "max";
                                      min: "min";
                                      sum: "sum";
                                      values: "values";
                                    }>
                                  >
                                >;
                                limit: z.ZodOptional<
                                  z.ZodEnum<{
                                    all: "all";
                                    first: "first";
                                  }>
                                >;
                              },
                              z.core.$strip
                            >
                          >;
                          multiple: z.ZodOptional<z.ZodBoolean>;
                          number: z.ZodOptional<
                            z.ZodObject<
                              {
                                format: z.ZodOptional<
                                  z.ZodEnum<{
                                    currency: "currency";
                                    plain: "plain";
                                  }>
                                >;
                                currency: z.ZodOptional<z.ZodString>;
                                locale: z.ZodOptional<z.ZodString>;
                              },
                              z.core.$strip
                            >
                          >;
                          targetBaseId: z.ZodOptional<z.ZodString>;
                          targetBaseSlug: z.ZodOptional<z.ZodString>;
                        },
                        z.core.$strip
                      >
                    >
                  >
                >;
              },
              z.core.$strip
            >
          >
        >;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        kind: z.ZodLiteral<"rename">;
        nodeId: z.ZodString;
        slug: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        icon: z.ZodOptional<
          z.ZodNullable<
            z.ZodDiscriminatedUnion<
              [
                z.ZodObject<
                  {
                    type: z.ZodLiteral<"emoji">;
                    value: z.ZodString;
                  },
                  z.core.$strip
                >,
                z.ZodObject<
                  {
                    type: z.ZodLiteral<"attachment">;
                    url: z.ZodString;
                    attachmentId: z.ZodString;
                    originalUrl: z.ZodOptional<z.ZodString>;
                    originalAttachmentId: z.ZodOptional<z.ZodString>;
                    crop: z.ZodOptional<
                      z.ZodObject<
                        {
                          x: z.ZodNumber;
                          y: z.ZodNumber;
                          zoom: z.ZodNumber;
                        },
                        z.core.$strip
                      >
                    >;
                  },
                  z.core.$strip
                >,
              ],
              "type"
            >
          >
        >;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        kind: z.ZodLiteral<"delete">;
        nodeId: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        kind: z.ZodLiteral<"restore">;
        nodeId: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        kind: z.ZodLiteral<"move">;
        nodeId: z.ZodString;
        parentNodeId: z.ZodOptional<z.ZodString>;
        parentNodeRef: z.ZodOptional<z.ZodString>;
        position: z.ZodOptional<z.ZodNumber>;
      },
      z.core.$strip
    >,
  ],
  "kind"
>;
declare const createNodeChangeRequestInputSchema: z.ZodObject<
  {
    message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
    operations: z.ZodArray<
      z.ZodDiscriminatedUnion<
        [
          z.ZodObject<
            {
              kind: z.ZodLiteral<"create">;
              ref: z.ZodOptional<z.ZodString>;
              parentNodeId: z.ZodOptional<z.ZodString>;
              parentNodeRef: z.ZodOptional<z.ZodString>;
              nodeType: z.ZodEnum<{
                [x: string]: string;
              }>;
              slug: z.ZodString;
              name: z.ZodString;
              description: z.ZodDefault<z.ZodOptional<z.ZodString>>;
              metadata: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
              fields: z.ZodOptional<
                z.ZodArray<
                  z.ZodObject<
                    {
                      slug: z.ZodString;
                      name: z.ZodUnion<
                        readonly [
                          z.ZodString,
                          z.ZodRecord<
                            z.ZodEnum<{
                              de: "de";
                              en: "en";
                              es: "es";
                              fr: "fr";
                              ja: "ja";
                              ko: "ko";
                              pt: "pt";
                              "zh-CN": "zh-CN";
                              "zh-TW": "zh-TW";
                            }> &
                              z.core.$partial,
                            z.ZodString
                          >,
                        ]
                      >;
                      type: z.ZodDefault<
                        z.ZodEnum<{
                          ai_summary: "ai_summary";
                          ai_tags: "ai_tags";
                          attachment: "attachment";
                          auto_number: "auto_number";
                          checkbox: "checkbox";
                          code: "code";
                          created_by: "created_by";
                          created_time: "created_time";
                          date: "date";
                          email: "email";
                          embed: "embed";
                          formula: "formula";
                          html: "html";
                          json: "json";
                          longtext: "longtext";
                          lookup: "lookup";
                          markdown: "markdown";
                          multiselect: "multiselect";
                          number: "number";
                          phone: "phone";
                          relation: "relation";
                          select: "select";
                          text: "text";
                          updated_by: "updated_by";
                          updated_time: "updated_time";
                          url: "url";
                          whiteboard: "whiteboard";
                          yaml: "yaml";
                        }>
                      >;
                      required: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
                      options: z.ZodDefault<
                        z.ZodOptional<
                          z.ZodDefault<
                            z.ZodObject<
                              {
                                ai: z.ZodOptional<
                                  z.ZodObject<
                                    {
                                      model: z.ZodOptional<z.ZodString>;
                                      prompt: z.ZodOptional<z.ZodString>;
                                      reviewRequired: z.ZodOptional<z.ZodBoolean>;
                                      sourceFieldIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                                    },
                                    z.core.$strip
                                  >
                                >;
                                attachment: z.ZodOptional<
                                  z.ZodObject<
                                    {
                                      maxFiles: z.ZodOptional<z.ZodNumber>;
                                      allowedMimeTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
                                      maxFileSize: z.ZodOptional<z.ZodNumber>;
                                    },
                                    z.core.$strip
                                  >
                                >;
                                choices: z.ZodOptional<
                                  z.ZodArray<
                                    z.ZodObject<
                                      {
                                        color: z.ZodOptional<z.ZodString>;
                                        id: z.ZodString;
                                        name: z.ZodString;
                                      },
                                      z.core.$strip
                                    >
                                  >
                                >;
                                code: z.ZodOptional<
                                  z.ZodObject<
                                    {
                                      language: z.ZodOptional<z.ZodString>;
                                    },
                                    z.core.$strip
                                  >
                                >;
                                embed: z.ZodOptional<
                                  z.ZodObject<
                                    {
                                      aspectRatio: z.ZodOptional<
                                        z.ZodEnum<{
                                          "16:9": "16:9";
                                          "1:1": "1:1";
                                          "4:3": "4:3";
                                        }>
                                      >;
                                      height: z.ZodOptional<z.ZodNumber>;
                                      providers: z.ZodOptional<z.ZodArray<z.ZodString>>;
                                    },
                                    z.core.$strip
                                  >
                                >;
                                formula: z.ZodOptional<
                                  z.ZodObject<
                                    {
                                      expression: z.ZodString;
                                    },
                                    z.core.$strip
                                  >
                                >;
                                inverseFieldId: z.ZodOptional<z.ZodString>;
                                lookup: z.ZodOptional<
                                  z.ZodObject<
                                    {
                                      relationFieldSlug: z.ZodString;
                                      targetFieldSlug: z.ZodString;
                                      rollup: z.ZodOptional<
                                        z.ZodDefault<
                                          z.ZodEnum<{
                                            average: "average";
                                            concatenate: "concatenate";
                                            count: "count";
                                            max: "max";
                                            min: "min";
                                            sum: "sum";
                                            values: "values";
                                          }>
                                        >
                                      >;
                                      limit: z.ZodOptional<
                                        z.ZodEnum<{
                                          all: "all";
                                          first: "first";
                                        }>
                                      >;
                                    },
                                    z.core.$strip
                                  >
                                >;
                                multiple: z.ZodOptional<z.ZodBoolean>;
                                number: z.ZodOptional<
                                  z.ZodObject<
                                    {
                                      format: z.ZodOptional<
                                        z.ZodEnum<{
                                          currency: "currency";
                                          plain: "plain";
                                        }>
                                      >;
                                      currency: z.ZodOptional<z.ZodString>;
                                      locale: z.ZodOptional<z.ZodString>;
                                    },
                                    z.core.$strip
                                  >
                                >;
                                targetBaseId: z.ZodOptional<z.ZodString>;
                                targetBaseSlug: z.ZodOptional<z.ZodString>;
                              },
                              z.core.$strip
                            >
                          >
                        >
                      >;
                    },
                    z.core.$strip
                  >
                >
              >;
            },
            z.core.$strip
          >,
          z.ZodObject<
            {
              kind: z.ZodLiteral<"rename">;
              nodeId: z.ZodString;
              slug: z.ZodOptional<z.ZodString>;
              name: z.ZodOptional<z.ZodString>;
              description: z.ZodOptional<z.ZodString>;
              icon: z.ZodOptional<
                z.ZodNullable<
                  z.ZodDiscriminatedUnion<
                    [
                      z.ZodObject<
                        {
                          type: z.ZodLiteral<"emoji">;
                          value: z.ZodString;
                        },
                        z.core.$strip
                      >,
                      z.ZodObject<
                        {
                          type: z.ZodLiteral<"attachment">;
                          url: z.ZodString;
                          attachmentId: z.ZodString;
                          originalUrl: z.ZodOptional<z.ZodString>;
                          originalAttachmentId: z.ZodOptional<z.ZodString>;
                          crop: z.ZodOptional<
                            z.ZodObject<
                              {
                                x: z.ZodNumber;
                                y: z.ZodNumber;
                                zoom: z.ZodNumber;
                              },
                              z.core.$strip
                            >
                          >;
                        },
                        z.core.$strip
                      >,
                    ],
                    "type"
                  >
                >
              >;
            },
            z.core.$strip
          >,
          z.ZodObject<
            {
              kind: z.ZodLiteral<"delete">;
              nodeId: z.ZodString;
            },
            z.core.$strip
          >,
          z.ZodObject<
            {
              kind: z.ZodLiteral<"restore">;
              nodeId: z.ZodString;
            },
            z.core.$strip
          >,
          z.ZodObject<
            {
              kind: z.ZodLiteral<"move">;
              nodeId: z.ZodString;
              parentNodeId: z.ZodOptional<z.ZodString>;
              parentNodeRef: z.ZodOptional<z.ZodString>;
              position: z.ZodOptional<z.ZodNumber>;
            },
            z.core.$strip
          >,
        ],
        "kind"
      >
    >;
  },
  z.core.$strip
>;
declare const moveNodeInputSchema: z.ZodObject<
  {
    nodeId: z.ZodString;
    parentNodeId: z.ZodOptional<z.ZodString>;
    position: z.ZodOptional<z.ZodNumber>;
    message: z.ZodOptional<z.ZodString>;
    submittedBy: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
declare const createDeleteChangeRequestInputSchema: z.ZodObject<
  {
    message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    deleteMode: z.ZodDefault<
      z.ZodOptional<
        z.ZodEnum<{
          archive: "archive";
        }>
      >
    >;
    autoMerge: z.ZodOptional<z.ZodLiteral<false>>;
  },
  z.core.$strip
>;
declare const reviseOperationInputSchema: z.ZodObject<
  {
    fields: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    author: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    baseCommitId: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
declare const reviewChangeRequestInputSchema: z.ZodObject<
  {
    verdict: z.ZodEnum<{
      approved: "approved";
      rejected: "rejected";
    }>;
    reason: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
declare const commentSubjectInputSchema: z.ZodObject<
  {
    subjectType: z.ZodEnum<{
      change_request: "change_request";
      commit: "commit";
      operation: "operation";
      record: "record";
    }>;
    subjectId: z.ZodString;
  },
  z.core.$strip
>;
declare const createCommentInputSchema: z.ZodObject<
  {
    subjectType: z.ZodEnum<{
      change_request: "change_request";
      commit: "commit";
      operation: "operation";
      record: "record";
    }>;
    subjectId: z.ZodString;
    authorId: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    body: z.ZodString;
    mentionsAi: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
  },
  z.core.$strip
>;
declare const listInputSchema: z.ZodDefault<
  z.ZodOptional<
    z.ZodObject<
      {
        limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
      },
      z.core.$strip
    >
  >
>;
/**
 * Active-or-archived selector for listings whose archived twin was folded in.
 * Archived rows are the same shape as live ones — the only thing that ever
 * differed between `/x` and `/x/archived` was this predicate.
 */
declare const listByStatusInputSchema: z.ZodObject<
  {
    status: z.ZodDefault<
      z.ZodOptional<
        z.ZodEnum<{
          active: "active";
          archived: "archived";
        }>
      >
    >;
  },
  z.core.$strip
>;
declare const listChangeRequestsPagedInputSchema: z.ZodDefault<
  z.ZodOptional<
    z.ZodObject<
      {
        limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
        cursor: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<
          z.ZodArray<
            z.ZodEnum<{
              abandoned: "abandoned";
              approved: "approved";
              changes_requested: "changes_requested";
              conflict: "conflict";
              in_review: "in_review";
              merged: "merged";
              rejected: "rejected";
            }>
          >
        >;
        mine: z.ZodOptional<z.ZodBoolean>;
      },
      z.core.$strip
    >
  >
>;
declare const listChangeRequestsResponseSchema: z.ZodObject<
  {
    changeRequests: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          baseId: z.ZodNullable<z.ZodString>;
          targetType: z.ZodEnum<{
            base: "base";
            node: "node";
          }>;
          nodeId: z.ZodNullable<z.ZodString>;
          status: z.ZodEnum<{
            abandoned: "abandoned";
            approved: "approved";
            changes_requested: "changes_requested";
            conflict: "conflict";
            in_review: "in_review";
            merged: "merged";
            rejected: "rejected";
          }>;
          submittedBy: z.ZodString;
          submittedByUser: z.ZodDefault<
            z.ZodOptional<
              z.ZodNullable<
                z.ZodObject<
                  {
                    id: z.ZodString;
                    name: z.ZodNullable<z.ZodString>;
                    email: z.ZodNullable<z.ZodString>;
                    image: z.ZodNullable<z.ZodString>;
                    role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                  },
                  z.core.$strip
                >
              >
            >
          >;
          sourceMeta: z.ZodRecord<z.ZodString, z.ZodUnknown>;
          reviewPolicySnapshot: z.ZodRecord<z.ZodString, z.ZodUnknown>;
          mergeSummary: z.ZodRecord<z.ZodString, z.ZodUnknown>;
          rejectedReason: z.ZodNullable<z.ZodString>;
          reviewedAt: z.ZodNullable<z.ZodString>;
          mergedAt: z.ZodNullable<z.ZodString>;
          createdAt: z.ZodString;
          updatedAt: z.ZodString;
          base: z.ZodNullable<
            z.ZodObject<
              {
                id: z.ZodString;
                nodeId: z.ZodString;
                slug: z.ZodString;
                name: z.ZodString;
                description: z.ZodString;
                reviewPolicy: z.ZodObject<
                  {
                    kind: z.ZodLiteral<"single">;
                    requiredApprovals: z.ZodNumber;
                  },
                  z.core.$strip
                >;
                createdAt: z.ZodString;
                fields: z.ZodArray<
                  z.ZodObject<
                    {
                      id: z.ZodString;
                      baseId: z.ZodString;
                      slug: z.ZodString;
                      name: z.ZodUnion<
                        readonly [
                          z.ZodString,
                          z.ZodRecord<
                            z.ZodEnum<{
                              de: "de";
                              en: "en";
                              es: "es";
                              fr: "fr";
                              ja: "ja";
                              ko: "ko";
                              pt: "pt";
                              "zh-CN": "zh-CN";
                              "zh-TW": "zh-TW";
                            }> &
                              z.core.$partial,
                            z.ZodString
                          >,
                        ]
                      >;
                      type: z.ZodEnum<{
                        ai_summary: "ai_summary";
                        ai_tags: "ai_tags";
                        attachment: "attachment";
                        auto_number: "auto_number";
                        checkbox: "checkbox";
                        code: "code";
                        created_by: "created_by";
                        created_time: "created_time";
                        date: "date";
                        email: "email";
                        embed: "embed";
                        formula: "formula";
                        html: "html";
                        json: "json";
                        longtext: "longtext";
                        lookup: "lookup";
                        markdown: "markdown";
                        multiselect: "multiselect";
                        number: "number";
                        phone: "phone";
                        relation: "relation";
                        select: "select";
                        text: "text";
                        updated_by: "updated_by";
                        updated_time: "updated_time";
                        url: "url";
                        whiteboard: "whiteboard";
                        yaml: "yaml";
                      }>;
                      required: z.ZodBoolean;
                      position: z.ZodNumber;
                      options: z.ZodDefault<
                        z.ZodObject<
                          {
                            ai: z.ZodOptional<
                              z.ZodObject<
                                {
                                  model: z.ZodOptional<z.ZodString>;
                                  prompt: z.ZodOptional<z.ZodString>;
                                  reviewRequired: z.ZodOptional<z.ZodBoolean>;
                                  sourceFieldIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                                },
                                z.core.$strip
                              >
                            >;
                            attachment: z.ZodOptional<
                              z.ZodObject<
                                {
                                  maxFiles: z.ZodOptional<z.ZodNumber>;
                                  allowedMimeTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
                                  maxFileSize: z.ZodOptional<z.ZodNumber>;
                                },
                                z.core.$strip
                              >
                            >;
                            choices: z.ZodOptional<
                              z.ZodArray<
                                z.ZodObject<
                                  {
                                    color: z.ZodOptional<z.ZodString>;
                                    id: z.ZodString;
                                    name: z.ZodString;
                                  },
                                  z.core.$strip
                                >
                              >
                            >;
                            code: z.ZodOptional<
                              z.ZodObject<
                                {
                                  language: z.ZodOptional<z.ZodString>;
                                },
                                z.core.$strip
                              >
                            >;
                            embed: z.ZodOptional<
                              z.ZodObject<
                                {
                                  aspectRatio: z.ZodOptional<
                                    z.ZodEnum<{
                                      "16:9": "16:9";
                                      "1:1": "1:1";
                                      "4:3": "4:3";
                                    }>
                                  >;
                                  height: z.ZodOptional<z.ZodNumber>;
                                  providers: z.ZodOptional<z.ZodArray<z.ZodString>>;
                                },
                                z.core.$strip
                              >
                            >;
                            formula: z.ZodOptional<
                              z.ZodObject<
                                {
                                  expression: z.ZodString;
                                },
                                z.core.$strip
                              >
                            >;
                            inverseFieldId: z.ZodOptional<z.ZodString>;
                            lookup: z.ZodOptional<
                              z.ZodObject<
                                {
                                  relationFieldSlug: z.ZodString;
                                  targetFieldSlug: z.ZodString;
                                  rollup: z.ZodOptional<
                                    z.ZodDefault<
                                      z.ZodEnum<{
                                        average: "average";
                                        concatenate: "concatenate";
                                        count: "count";
                                        max: "max";
                                        min: "min";
                                        sum: "sum";
                                        values: "values";
                                      }>
                                    >
                                  >;
                                  limit: z.ZodOptional<
                                    z.ZodEnum<{
                                      all: "all";
                                      first: "first";
                                    }>
                                  >;
                                },
                                z.core.$strip
                              >
                            >;
                            multiple: z.ZodOptional<z.ZodBoolean>;
                            number: z.ZodOptional<
                              z.ZodObject<
                                {
                                  format: z.ZodOptional<
                                    z.ZodEnum<{
                                      currency: "currency";
                                      plain: "plain";
                                    }>
                                  >;
                                  currency: z.ZodOptional<z.ZodString>;
                                  locale: z.ZodOptional<z.ZodString>;
                                },
                                z.core.$strip
                              >
                            >;
                            targetBaseId: z.ZodOptional<z.ZodString>;
                            targetBaseSlug: z.ZodOptional<z.ZodString>;
                          },
                          z.core.$strip
                        >
                      >;
                    },
                    z.core.$strip
                  >
                >;
              },
              z.core.$strip
            >
          >;
          node: z.ZodNullable<
            z.ZodType<NodeOutput, unknown, z.core.$ZodTypeInternals<NodeOutput, unknown>>
          >;
          operations: z.ZodArray<
            z.ZodObject<
              {
                id: z.ZodString;
                changeRequestId: z.ZodString;
                baseId: z.ZodNullable<z.ZodString>;
                targetType: z.ZodEnum<{
                  base: "base";
                  node: "node";
                }>;
                nodeId: z.ZodNullable<z.ZodString>;
                operation: z.ZodEnum<{
                  [x: `${string}_file_create`]: `${string}_file_create`;
                  [x: `${string}_file_delete`]: `${string}_file_delete`;
                  [x: `${string}_file_update`]: `${string}_file_update`;
                  [x: `${string}_metadata_update`]: `${string}_metadata_update`;
                  base_add_field: "base_add_field";
                  base_archive: "base_archive";
                  base_convert_field: "base_convert_field";
                  base_delete_field: "base_delete_field";
                  base_reorder_fields: "base_reorder_fields";
                  base_restore: "base_restore";
                  base_restore_field: "base_restore_field";
                  base_update_field: "base_update_field";
                  doc_update: "doc_update";
                  html_document_update: "html_document_update";
                  node_create: "node_create";
                  node_delete: "node_delete";
                  node_move: "node_move";
                  node_rename: "node_rename";
                  node_restore: "node_restore";
                  record_create: "record_create";
                  record_delete: "record_delete";
                  record_restore: "record_restore";
                  record_update: "record_update";
                  record_variant: "record_variant";
                  view_create: "view_create";
                  view_delete: "view_delete";
                  view_restore: "view_restore";
                  view_update: "view_update";
                  whiteboard_document_update: "whiteboard_document_update";
                  workflow_document_update: "workflow_document_update";
                }>;
                status: z.ZodEnum<{
                  archived: "archived";
                  failed: "failed";
                  merged: "merged";
                  pending: "pending";
                }>;
                targetRecordId: z.ZodNullable<z.ZodString>;
                targetViewId: z.ZodNullable<z.ZodString>;
                filePath: z.ZodNullable<z.ZodString>;
                sourceRecordId: z.ZodNullable<z.ZodString>;
                sourceCommitId: z.ZodNullable<z.ZodString>;
                baseCommitId: z.ZodNullable<z.ZodString>;
                headCommitId: z.ZodString;
                deleteMode: z.ZodEnum<{
                  archive: "archive";
                }>;
                mergedRecordId: z.ZodNullable<z.ZodString>;
                mergedViewId: z.ZodNullable<z.ZodString>;
                position: z.ZodNumber;
                createdAt: z.ZodString;
                updatedAt: z.ZodString;
                headCommit: z.ZodObject<
                  {
                    id: z.ZodString;
                    baseId: z.ZodNullable<z.ZodString>;
                    targetType: z.ZodEnum<{
                      base: "base";
                      node: "node";
                    }>;
                    nodeId: z.ZodNullable<z.ZodString>;
                    operationId: z.ZodNullable<z.ZodString>;
                    parentCommitId: z.ZodNullable<z.ZodString>;
                    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
                    operation: z.ZodEnum<{
                      [x: `${string}_file_create`]: `${string}_file_create`;
                      [x: `${string}_file_delete`]: `${string}_file_delete`;
                      [x: `${string}_file_update`]: `${string}_file_update`;
                      [x: `${string}_metadata_update`]: `${string}_metadata_update`;
                      base_add_field: "base_add_field";
                      base_archive: "base_archive";
                      base_convert_field: "base_convert_field";
                      base_delete_field: "base_delete_field";
                      base_reorder_fields: "base_reorder_fields";
                      base_restore: "base_restore";
                      base_restore_field: "base_restore_field";
                      base_update_field: "base_update_field";
                      doc_update: "doc_update";
                      html_document_update: "html_document_update";
                      node_create: "node_create";
                      node_delete: "node_delete";
                      node_move: "node_move";
                      node_rename: "node_rename";
                      node_restore: "node_restore";
                      record_create: "record_create";
                      record_delete: "record_delete";
                      record_restore: "record_restore";
                      record_update: "record_update";
                      record_variant: "record_variant";
                      view_create: "view_create";
                      view_delete: "view_delete";
                      view_restore: "view_restore";
                      view_update: "view_update";
                      whiteboard_document_update: "whiteboard_document_update";
                      workflow_document_update: "workflow_document_update";
                    }>;
                    message: z.ZodString;
                    author: z.ZodString;
                    authorUser: z.ZodDefault<
                      z.ZodOptional<
                        z.ZodNullable<
                          z.ZodObject<
                            {
                              id: z.ZodString;
                              name: z.ZodNullable<z.ZodString>;
                              email: z.ZodNullable<z.ZodString>;
                              image: z.ZodNullable<z.ZodString>;
                              role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                            },
                            z.core.$strip
                          >
                        >
                      >
                    >;
                    createdAt: z.ZodString;
                  },
                  z.core.$strip
                >;
                baseFields: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
              },
              z.core.$strip
            >
          >;
          primaryOperation: z.ZodNullable<
            z.ZodObject<
              {
                id: z.ZodString;
                changeRequestId: z.ZodString;
                baseId: z.ZodNullable<z.ZodString>;
                targetType: z.ZodEnum<{
                  base: "base";
                  node: "node";
                }>;
                nodeId: z.ZodNullable<z.ZodString>;
                operation: z.ZodEnum<{
                  [x: `${string}_file_create`]: `${string}_file_create`;
                  [x: `${string}_file_delete`]: `${string}_file_delete`;
                  [x: `${string}_file_update`]: `${string}_file_update`;
                  [x: `${string}_metadata_update`]: `${string}_metadata_update`;
                  base_add_field: "base_add_field";
                  base_archive: "base_archive";
                  base_convert_field: "base_convert_field";
                  base_delete_field: "base_delete_field";
                  base_reorder_fields: "base_reorder_fields";
                  base_restore: "base_restore";
                  base_restore_field: "base_restore_field";
                  base_update_field: "base_update_field";
                  doc_update: "doc_update";
                  html_document_update: "html_document_update";
                  node_create: "node_create";
                  node_delete: "node_delete";
                  node_move: "node_move";
                  node_rename: "node_rename";
                  node_restore: "node_restore";
                  record_create: "record_create";
                  record_delete: "record_delete";
                  record_restore: "record_restore";
                  record_update: "record_update";
                  record_variant: "record_variant";
                  view_create: "view_create";
                  view_delete: "view_delete";
                  view_restore: "view_restore";
                  view_update: "view_update";
                  whiteboard_document_update: "whiteboard_document_update";
                  workflow_document_update: "workflow_document_update";
                }>;
                status: z.ZodEnum<{
                  archived: "archived";
                  failed: "failed";
                  merged: "merged";
                  pending: "pending";
                }>;
                targetRecordId: z.ZodNullable<z.ZodString>;
                targetViewId: z.ZodNullable<z.ZodString>;
                filePath: z.ZodNullable<z.ZodString>;
                sourceRecordId: z.ZodNullable<z.ZodString>;
                sourceCommitId: z.ZodNullable<z.ZodString>;
                baseCommitId: z.ZodNullable<z.ZodString>;
                headCommitId: z.ZodString;
                deleteMode: z.ZodEnum<{
                  archive: "archive";
                }>;
                mergedRecordId: z.ZodNullable<z.ZodString>;
                mergedViewId: z.ZodNullable<z.ZodString>;
                position: z.ZodNumber;
                createdAt: z.ZodString;
                updatedAt: z.ZodString;
                headCommit: z.ZodObject<
                  {
                    id: z.ZodString;
                    baseId: z.ZodNullable<z.ZodString>;
                    targetType: z.ZodEnum<{
                      base: "base";
                      node: "node";
                    }>;
                    nodeId: z.ZodNullable<z.ZodString>;
                    operationId: z.ZodNullable<z.ZodString>;
                    parentCommitId: z.ZodNullable<z.ZodString>;
                    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
                    operation: z.ZodEnum<{
                      [x: `${string}_file_create`]: `${string}_file_create`;
                      [x: `${string}_file_delete`]: `${string}_file_delete`;
                      [x: `${string}_file_update`]: `${string}_file_update`;
                      [x: `${string}_metadata_update`]: `${string}_metadata_update`;
                      base_add_field: "base_add_field";
                      base_archive: "base_archive";
                      base_convert_field: "base_convert_field";
                      base_delete_field: "base_delete_field";
                      base_reorder_fields: "base_reorder_fields";
                      base_restore: "base_restore";
                      base_restore_field: "base_restore_field";
                      base_update_field: "base_update_field";
                      doc_update: "doc_update";
                      html_document_update: "html_document_update";
                      node_create: "node_create";
                      node_delete: "node_delete";
                      node_move: "node_move";
                      node_rename: "node_rename";
                      node_restore: "node_restore";
                      record_create: "record_create";
                      record_delete: "record_delete";
                      record_restore: "record_restore";
                      record_update: "record_update";
                      record_variant: "record_variant";
                      view_create: "view_create";
                      view_delete: "view_delete";
                      view_restore: "view_restore";
                      view_update: "view_update";
                      whiteboard_document_update: "whiteboard_document_update";
                      workflow_document_update: "workflow_document_update";
                    }>;
                    message: z.ZodString;
                    author: z.ZodString;
                    authorUser: z.ZodDefault<
                      z.ZodOptional<
                        z.ZodNullable<
                          z.ZodObject<
                            {
                              id: z.ZodString;
                              name: z.ZodNullable<z.ZodString>;
                              email: z.ZodNullable<z.ZodString>;
                              image: z.ZodNullable<z.ZodString>;
                              role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                            },
                            z.core.$strip
                          >
                        >
                      >
                    >;
                    createdAt: z.ZodString;
                  },
                  z.core.$strip
                >;
                baseFields: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
              },
              z.core.$strip
            >
          >;
          operationCount: z.ZodNumber;
          reviews: z.ZodArray<
            z.ZodObject<
              {
                id: z.ZodString;
                changeRequestId: z.ZodString;
                reviewerId: z.ZodString;
                reviewer: z.ZodDefault<
                  z.ZodOptional<
                    z.ZodNullable<
                      z.ZodObject<
                        {
                          id: z.ZodString;
                          name: z.ZodNullable<z.ZodString>;
                          email: z.ZodNullable<z.ZodString>;
                          image: z.ZodNullable<z.ZodString>;
                          role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                        },
                        z.core.$strip
                      >
                    >
                  >
                >;
                verdict: z.ZodEnum<{
                  approved: "approved";
                  rejected: "rejected";
                }>;
                reason: z.ZodNullable<z.ZodString>;
                visibleOperationHeads: z.ZodRecord<z.ZodString, z.ZodString>;
                createdAt: z.ZodString;
              },
              z.core.$strip
            >
          >;
        },
        z.core.$strip
      >
    >;
    nextCursor: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
declare const listChangeRequestsPageInputSchema: z.ZodDefault<
  z.ZodOptional<
    z.ZodObject<
      {
        page: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
        pageSize: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
        status: z.ZodOptional<
          z.ZodArray<
            z.ZodEnum<{
              abandoned: "abandoned";
              approved: "approved";
              changes_requested: "changes_requested";
              conflict: "conflict";
              in_review: "in_review";
              merged: "merged";
              rejected: "rejected";
            }>
          >
        >;
        mine: z.ZodOptional<z.ZodBoolean>;
      },
      z.core.$strip
    >
  >
>;
declare const listChangeRequestsPageResponseSchema: z.ZodObject<
  {
    changeRequests: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          baseId: z.ZodNullable<z.ZodString>;
          targetType: z.ZodEnum<{
            base: "base";
            node: "node";
          }>;
          nodeId: z.ZodNullable<z.ZodString>;
          status: z.ZodEnum<{
            abandoned: "abandoned";
            approved: "approved";
            changes_requested: "changes_requested";
            conflict: "conflict";
            in_review: "in_review";
            merged: "merged";
            rejected: "rejected";
          }>;
          submittedBy: z.ZodString;
          submittedByUser: z.ZodDefault<
            z.ZodOptional<
              z.ZodNullable<
                z.ZodObject<
                  {
                    id: z.ZodString;
                    name: z.ZodNullable<z.ZodString>;
                    email: z.ZodNullable<z.ZodString>;
                    image: z.ZodNullable<z.ZodString>;
                    role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                  },
                  z.core.$strip
                >
              >
            >
          >;
          sourceMeta: z.ZodRecord<z.ZodString, z.ZodUnknown>;
          reviewPolicySnapshot: z.ZodRecord<z.ZodString, z.ZodUnknown>;
          mergeSummary: z.ZodRecord<z.ZodString, z.ZodUnknown>;
          rejectedReason: z.ZodNullable<z.ZodString>;
          reviewedAt: z.ZodNullable<z.ZodString>;
          mergedAt: z.ZodNullable<z.ZodString>;
          createdAt: z.ZodString;
          updatedAt: z.ZodString;
          base: z.ZodNullable<
            z.ZodObject<
              {
                id: z.ZodString;
                nodeId: z.ZodString;
                slug: z.ZodString;
                name: z.ZodString;
                description: z.ZodString;
                reviewPolicy: z.ZodObject<
                  {
                    kind: z.ZodLiteral<"single">;
                    requiredApprovals: z.ZodNumber;
                  },
                  z.core.$strip
                >;
                createdAt: z.ZodString;
                fields: z.ZodArray<
                  z.ZodObject<
                    {
                      id: z.ZodString;
                      baseId: z.ZodString;
                      slug: z.ZodString;
                      name: z.ZodUnion<
                        readonly [
                          z.ZodString,
                          z.ZodRecord<
                            z.ZodEnum<{
                              de: "de";
                              en: "en";
                              es: "es";
                              fr: "fr";
                              ja: "ja";
                              ko: "ko";
                              pt: "pt";
                              "zh-CN": "zh-CN";
                              "zh-TW": "zh-TW";
                            }> &
                              z.core.$partial,
                            z.ZodString
                          >,
                        ]
                      >;
                      type: z.ZodEnum<{
                        ai_summary: "ai_summary";
                        ai_tags: "ai_tags";
                        attachment: "attachment";
                        auto_number: "auto_number";
                        checkbox: "checkbox";
                        code: "code";
                        created_by: "created_by";
                        created_time: "created_time";
                        date: "date";
                        email: "email";
                        embed: "embed";
                        formula: "formula";
                        html: "html";
                        json: "json";
                        longtext: "longtext";
                        lookup: "lookup";
                        markdown: "markdown";
                        multiselect: "multiselect";
                        number: "number";
                        phone: "phone";
                        relation: "relation";
                        select: "select";
                        text: "text";
                        updated_by: "updated_by";
                        updated_time: "updated_time";
                        url: "url";
                        whiteboard: "whiteboard";
                        yaml: "yaml";
                      }>;
                      required: z.ZodBoolean;
                      position: z.ZodNumber;
                      options: z.ZodDefault<
                        z.ZodObject<
                          {
                            ai: z.ZodOptional<
                              z.ZodObject<
                                {
                                  model: z.ZodOptional<z.ZodString>;
                                  prompt: z.ZodOptional<z.ZodString>;
                                  reviewRequired: z.ZodOptional<z.ZodBoolean>;
                                  sourceFieldIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                                },
                                z.core.$strip
                              >
                            >;
                            attachment: z.ZodOptional<
                              z.ZodObject<
                                {
                                  maxFiles: z.ZodOptional<z.ZodNumber>;
                                  allowedMimeTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
                                  maxFileSize: z.ZodOptional<z.ZodNumber>;
                                },
                                z.core.$strip
                              >
                            >;
                            choices: z.ZodOptional<
                              z.ZodArray<
                                z.ZodObject<
                                  {
                                    color: z.ZodOptional<z.ZodString>;
                                    id: z.ZodString;
                                    name: z.ZodString;
                                  },
                                  z.core.$strip
                                >
                              >
                            >;
                            code: z.ZodOptional<
                              z.ZodObject<
                                {
                                  language: z.ZodOptional<z.ZodString>;
                                },
                                z.core.$strip
                              >
                            >;
                            embed: z.ZodOptional<
                              z.ZodObject<
                                {
                                  aspectRatio: z.ZodOptional<
                                    z.ZodEnum<{
                                      "16:9": "16:9";
                                      "1:1": "1:1";
                                      "4:3": "4:3";
                                    }>
                                  >;
                                  height: z.ZodOptional<z.ZodNumber>;
                                  providers: z.ZodOptional<z.ZodArray<z.ZodString>>;
                                },
                                z.core.$strip
                              >
                            >;
                            formula: z.ZodOptional<
                              z.ZodObject<
                                {
                                  expression: z.ZodString;
                                },
                                z.core.$strip
                              >
                            >;
                            inverseFieldId: z.ZodOptional<z.ZodString>;
                            lookup: z.ZodOptional<
                              z.ZodObject<
                                {
                                  relationFieldSlug: z.ZodString;
                                  targetFieldSlug: z.ZodString;
                                  rollup: z.ZodOptional<
                                    z.ZodDefault<
                                      z.ZodEnum<{
                                        average: "average";
                                        concatenate: "concatenate";
                                        count: "count";
                                        max: "max";
                                        min: "min";
                                        sum: "sum";
                                        values: "values";
                                      }>
                                    >
                                  >;
                                  limit: z.ZodOptional<
                                    z.ZodEnum<{
                                      all: "all";
                                      first: "first";
                                    }>
                                  >;
                                },
                                z.core.$strip
                              >
                            >;
                            multiple: z.ZodOptional<z.ZodBoolean>;
                            number: z.ZodOptional<
                              z.ZodObject<
                                {
                                  format: z.ZodOptional<
                                    z.ZodEnum<{
                                      currency: "currency";
                                      plain: "plain";
                                    }>
                                  >;
                                  currency: z.ZodOptional<z.ZodString>;
                                  locale: z.ZodOptional<z.ZodString>;
                                },
                                z.core.$strip
                              >
                            >;
                            targetBaseId: z.ZodOptional<z.ZodString>;
                            targetBaseSlug: z.ZodOptional<z.ZodString>;
                          },
                          z.core.$strip
                        >
                      >;
                    },
                    z.core.$strip
                  >
                >;
              },
              z.core.$strip
            >
          >;
          node: z.ZodNullable<
            z.ZodType<NodeOutput, unknown, z.core.$ZodTypeInternals<NodeOutput, unknown>>
          >;
          operations: z.ZodArray<
            z.ZodObject<
              {
                id: z.ZodString;
                changeRequestId: z.ZodString;
                baseId: z.ZodNullable<z.ZodString>;
                targetType: z.ZodEnum<{
                  base: "base";
                  node: "node";
                }>;
                nodeId: z.ZodNullable<z.ZodString>;
                operation: z.ZodEnum<{
                  [x: `${string}_file_create`]: `${string}_file_create`;
                  [x: `${string}_file_delete`]: `${string}_file_delete`;
                  [x: `${string}_file_update`]: `${string}_file_update`;
                  [x: `${string}_metadata_update`]: `${string}_metadata_update`;
                  base_add_field: "base_add_field";
                  base_archive: "base_archive";
                  base_convert_field: "base_convert_field";
                  base_delete_field: "base_delete_field";
                  base_reorder_fields: "base_reorder_fields";
                  base_restore: "base_restore";
                  base_restore_field: "base_restore_field";
                  base_update_field: "base_update_field";
                  doc_update: "doc_update";
                  html_document_update: "html_document_update";
                  node_create: "node_create";
                  node_delete: "node_delete";
                  node_move: "node_move";
                  node_rename: "node_rename";
                  node_restore: "node_restore";
                  record_create: "record_create";
                  record_delete: "record_delete";
                  record_restore: "record_restore";
                  record_update: "record_update";
                  record_variant: "record_variant";
                  view_create: "view_create";
                  view_delete: "view_delete";
                  view_restore: "view_restore";
                  view_update: "view_update";
                  whiteboard_document_update: "whiteboard_document_update";
                  workflow_document_update: "workflow_document_update";
                }>;
                status: z.ZodEnum<{
                  archived: "archived";
                  failed: "failed";
                  merged: "merged";
                  pending: "pending";
                }>;
                targetRecordId: z.ZodNullable<z.ZodString>;
                targetViewId: z.ZodNullable<z.ZodString>;
                filePath: z.ZodNullable<z.ZodString>;
                sourceRecordId: z.ZodNullable<z.ZodString>;
                sourceCommitId: z.ZodNullable<z.ZodString>;
                baseCommitId: z.ZodNullable<z.ZodString>;
                headCommitId: z.ZodString;
                deleteMode: z.ZodEnum<{
                  archive: "archive";
                }>;
                mergedRecordId: z.ZodNullable<z.ZodString>;
                mergedViewId: z.ZodNullable<z.ZodString>;
                position: z.ZodNumber;
                createdAt: z.ZodString;
                updatedAt: z.ZodString;
                headCommit: z.ZodObject<
                  {
                    id: z.ZodString;
                    baseId: z.ZodNullable<z.ZodString>;
                    targetType: z.ZodEnum<{
                      base: "base";
                      node: "node";
                    }>;
                    nodeId: z.ZodNullable<z.ZodString>;
                    operationId: z.ZodNullable<z.ZodString>;
                    parentCommitId: z.ZodNullable<z.ZodString>;
                    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
                    operation: z.ZodEnum<{
                      [x: `${string}_file_create`]: `${string}_file_create`;
                      [x: `${string}_file_delete`]: `${string}_file_delete`;
                      [x: `${string}_file_update`]: `${string}_file_update`;
                      [x: `${string}_metadata_update`]: `${string}_metadata_update`;
                      base_add_field: "base_add_field";
                      base_archive: "base_archive";
                      base_convert_field: "base_convert_field";
                      base_delete_field: "base_delete_field";
                      base_reorder_fields: "base_reorder_fields";
                      base_restore: "base_restore";
                      base_restore_field: "base_restore_field";
                      base_update_field: "base_update_field";
                      doc_update: "doc_update";
                      html_document_update: "html_document_update";
                      node_create: "node_create";
                      node_delete: "node_delete";
                      node_move: "node_move";
                      node_rename: "node_rename";
                      node_restore: "node_restore";
                      record_create: "record_create";
                      record_delete: "record_delete";
                      record_restore: "record_restore";
                      record_update: "record_update";
                      record_variant: "record_variant";
                      view_create: "view_create";
                      view_delete: "view_delete";
                      view_restore: "view_restore";
                      view_update: "view_update";
                      whiteboard_document_update: "whiteboard_document_update";
                      workflow_document_update: "workflow_document_update";
                    }>;
                    message: z.ZodString;
                    author: z.ZodString;
                    authorUser: z.ZodDefault<
                      z.ZodOptional<
                        z.ZodNullable<
                          z.ZodObject<
                            {
                              id: z.ZodString;
                              name: z.ZodNullable<z.ZodString>;
                              email: z.ZodNullable<z.ZodString>;
                              image: z.ZodNullable<z.ZodString>;
                              role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                            },
                            z.core.$strip
                          >
                        >
                      >
                    >;
                    createdAt: z.ZodString;
                  },
                  z.core.$strip
                >;
                baseFields: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
              },
              z.core.$strip
            >
          >;
          primaryOperation: z.ZodNullable<
            z.ZodObject<
              {
                id: z.ZodString;
                changeRequestId: z.ZodString;
                baseId: z.ZodNullable<z.ZodString>;
                targetType: z.ZodEnum<{
                  base: "base";
                  node: "node";
                }>;
                nodeId: z.ZodNullable<z.ZodString>;
                operation: z.ZodEnum<{
                  [x: `${string}_file_create`]: `${string}_file_create`;
                  [x: `${string}_file_delete`]: `${string}_file_delete`;
                  [x: `${string}_file_update`]: `${string}_file_update`;
                  [x: `${string}_metadata_update`]: `${string}_metadata_update`;
                  base_add_field: "base_add_field";
                  base_archive: "base_archive";
                  base_convert_field: "base_convert_field";
                  base_delete_field: "base_delete_field";
                  base_reorder_fields: "base_reorder_fields";
                  base_restore: "base_restore";
                  base_restore_field: "base_restore_field";
                  base_update_field: "base_update_field";
                  doc_update: "doc_update";
                  html_document_update: "html_document_update";
                  node_create: "node_create";
                  node_delete: "node_delete";
                  node_move: "node_move";
                  node_rename: "node_rename";
                  node_restore: "node_restore";
                  record_create: "record_create";
                  record_delete: "record_delete";
                  record_restore: "record_restore";
                  record_update: "record_update";
                  record_variant: "record_variant";
                  view_create: "view_create";
                  view_delete: "view_delete";
                  view_restore: "view_restore";
                  view_update: "view_update";
                  whiteboard_document_update: "whiteboard_document_update";
                  workflow_document_update: "workflow_document_update";
                }>;
                status: z.ZodEnum<{
                  archived: "archived";
                  failed: "failed";
                  merged: "merged";
                  pending: "pending";
                }>;
                targetRecordId: z.ZodNullable<z.ZodString>;
                targetViewId: z.ZodNullable<z.ZodString>;
                filePath: z.ZodNullable<z.ZodString>;
                sourceRecordId: z.ZodNullable<z.ZodString>;
                sourceCommitId: z.ZodNullable<z.ZodString>;
                baseCommitId: z.ZodNullable<z.ZodString>;
                headCommitId: z.ZodString;
                deleteMode: z.ZodEnum<{
                  archive: "archive";
                }>;
                mergedRecordId: z.ZodNullable<z.ZodString>;
                mergedViewId: z.ZodNullable<z.ZodString>;
                position: z.ZodNumber;
                createdAt: z.ZodString;
                updatedAt: z.ZodString;
                headCommit: z.ZodObject<
                  {
                    id: z.ZodString;
                    baseId: z.ZodNullable<z.ZodString>;
                    targetType: z.ZodEnum<{
                      base: "base";
                      node: "node";
                    }>;
                    nodeId: z.ZodNullable<z.ZodString>;
                    operationId: z.ZodNullable<z.ZodString>;
                    parentCommitId: z.ZodNullable<z.ZodString>;
                    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
                    operation: z.ZodEnum<{
                      [x: `${string}_file_create`]: `${string}_file_create`;
                      [x: `${string}_file_delete`]: `${string}_file_delete`;
                      [x: `${string}_file_update`]: `${string}_file_update`;
                      [x: `${string}_metadata_update`]: `${string}_metadata_update`;
                      base_add_field: "base_add_field";
                      base_archive: "base_archive";
                      base_convert_field: "base_convert_field";
                      base_delete_field: "base_delete_field";
                      base_reorder_fields: "base_reorder_fields";
                      base_restore: "base_restore";
                      base_restore_field: "base_restore_field";
                      base_update_field: "base_update_field";
                      doc_update: "doc_update";
                      html_document_update: "html_document_update";
                      node_create: "node_create";
                      node_delete: "node_delete";
                      node_move: "node_move";
                      node_rename: "node_rename";
                      node_restore: "node_restore";
                      record_create: "record_create";
                      record_delete: "record_delete";
                      record_restore: "record_restore";
                      record_update: "record_update";
                      record_variant: "record_variant";
                      view_create: "view_create";
                      view_delete: "view_delete";
                      view_restore: "view_restore";
                      view_update: "view_update";
                      whiteboard_document_update: "whiteboard_document_update";
                      workflow_document_update: "workflow_document_update";
                    }>;
                    message: z.ZodString;
                    author: z.ZodString;
                    authorUser: z.ZodDefault<
                      z.ZodOptional<
                        z.ZodNullable<
                          z.ZodObject<
                            {
                              id: z.ZodString;
                              name: z.ZodNullable<z.ZodString>;
                              email: z.ZodNullable<z.ZodString>;
                              image: z.ZodNullable<z.ZodString>;
                              role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                            },
                            z.core.$strip
                          >
                        >
                      >
                    >;
                    createdAt: z.ZodString;
                  },
                  z.core.$strip
                >;
                baseFields: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
              },
              z.core.$strip
            >
          >;
          operationCount: z.ZodNumber;
          reviews: z.ZodArray<
            z.ZodObject<
              {
                id: z.ZodString;
                changeRequestId: z.ZodString;
                reviewerId: z.ZodString;
                reviewer: z.ZodDefault<
                  z.ZodOptional<
                    z.ZodNullable<
                      z.ZodObject<
                        {
                          id: z.ZodString;
                          name: z.ZodNullable<z.ZodString>;
                          email: z.ZodNullable<z.ZodString>;
                          image: z.ZodNullable<z.ZodString>;
                          role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                        },
                        z.core.$strip
                      >
                    >
                  >
                >;
                verdict: z.ZodEnum<{
                  approved: "approved";
                  rejected: "rejected";
                }>;
                reason: z.ZodNullable<z.ZodString>;
                visibleOperationHeads: z.ZodRecord<z.ZodString, z.ZodString>;
                createdAt: z.ZodString;
              },
              z.core.$strip
            >
          >;
        },
        z.core.$strip
      >
    >;
    total: z.ZodNumber;
    totalPages: z.ZodNumber;
    page: z.ZodNumber;
    pageSize: z.ZodNumber;
  },
  z.core.$strip
>;
declare const changeRequestCountsSchema: z.ZodObject<
  {
    review: z.ZodNumber;
    changes: z.ZodNumber;
    created: z.ZodNumber;
    approved: z.ZodNumber;
    merged: z.ZodNumber;
    rejected: z.ZodNumber;
  },
  z.core.$strip
>;
declare const searchInputSchema: z.ZodObject<
  {
    query: z.ZodDefault<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    offset: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    sources: z.ZodOptional<
      z.ZodPipe<
        z.ZodUnion<
          readonly [
            z.ZodArray<
              z.ZodEnum<{
                files: "files";
                names: "names";
                records: "records";
              }>
            >,
            z.ZodEnum<{
              files: "files";
              names: "names";
              records: "records";
            }>,
          ]
        >,
        z.ZodTransform<
          ("files" | "names" | "records")[],
          "files" | "names" | "records" | ("files" | "names" | "records")[]
        >
      >
    >;
  },
  z.core.$strip
>;
declare const authSpaceSchema: z.ZodObject<
  {
    id: z.ZodString;
    name: z.ZodString;
    slug: z.ZodNullable<z.ZodString>;
    plan: z.ZodNullable<z.ZodString>;
    nodeVisibilityMode: z.ZodOptional<
      z.ZodEnum<{
        open: "open";
        restricted: "restricted";
      }>
    >;
  },
  z.core.$strip
>;
declare const authUserSchema: z.ZodObject<
  {
    id: z.ZodString;
    name: z.ZodString;
    email: z.ZodNullable<z.ZodString>;
    image: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
declare const authMemberSchema: z.ZodObject<
  {
    userId: z.ZodString;
    spaceId: z.ZodString;
    role: z.ZodString;
  },
  z.core.$strip
>;
declare const authInfoSchema: z.ZodObject<
  {
    space: z.ZodObject<
      {
        id: z.ZodString;
        name: z.ZodString;
        slug: z.ZodNullable<z.ZodString>;
        plan: z.ZodNullable<z.ZodString>;
        nodeVisibilityMode: z.ZodOptional<
          z.ZodEnum<{
            open: "open";
            restricted: "restricted";
          }>
        >;
      },
      z.core.$strip
    >;
    user: z.ZodObject<
      {
        id: z.ZodString;
        name: z.ZodString;
        email: z.ZodNullable<z.ZodString>;
        image: z.ZodNullable<z.ZodString>;
      },
      z.core.$strip
    >;
    member: z.ZodObject<
      {
        userId: z.ZodString;
        spaceId: z.ZodString;
        role: z.ZodString;
      },
      z.core.$strip
    >;
    spaces: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          name: z.ZodString;
          slug: z.ZodNullable<z.ZodString>;
          plan: z.ZodNullable<z.ZodString>;
          nodeVisibilityMode: z.ZodOptional<
            z.ZodEnum<{
              open: "open";
              restricted: "restricted";
            }>
          >;
        },
        z.core.$strip
      >
    >;
    createdSpace: z.ZodOptional<z.ZodBoolean>;
    bootstrapRequired: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export type AuthInfo = z.infer<typeof authInfoSchema>;
export {
  authSpaceSchema,
  authUserSchema,
  authMemberSchema,
  authInfoSchema,
  userRefSchema,
  nodeSchema,
  nodePrincipalSchema,
  nodeShareSchema,
  listNodesInputSchema,
  isDescendantInputSchema,
  isDescendantOutputSchema,
  updateNodeMetadataInputSchema,
  searchNodesByNameInputSchema,
  nodeSearchResultSchema,
  commitSchema,
  operationSchema,
  reviewSchema,
  commentSubjectTypeSchema,
  commentSchema,
  changeRequestStatusSchema,
  changeRequestSchema,
  changeRequestCountsSchema,
  agentTaskSchema,
  searchResultSchema,
  searchResponseSchema,
  liveEventSchema,
  auditActionSchema,
  auditEventSchema,
  createAuditEventInputSchema,
  nodeOperationInputSchema,
  createNodeChangeRequestInputSchema,
  moveNodeInputSchema,
  createDeleteChangeRequestInputSchema,
  reviseOperationInputSchema,
  reviewChangeRequestInputSchema,
  commentSubjectInputSchema,
  createCommentInputSchema,
  listInputSchema,
  listByStatusInputSchema,
  listChangeRequestsPagedInputSchema,
  listChangeRequestsResponseSchema,
  listChangeRequestsPageInputSchema,
  listChangeRequestsPageResponseSchema,
  searchInputSchema,
};
