import { z } from "zod";
export declare const createFileNodeInputSchema: z.ZodObject<
  {
    parentNodeId: z.ZodOptional<z.ZodString>;
    slug: z.ZodString;
    name: z.ZodString;
    description: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    assetId: z.ZodString;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const fileContract: {
  create: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodObject<
      {
        parentNodeId: z.ZodOptional<z.ZodString>;
        slug: z.ZodString;
        name: z.ZodString;
        description: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        assetId: z.ZodString;
        autoMerge: z.ZodOptional<z.ZodBoolean>;
      },
      z.core.$strip
    >,
    z.ZodUnion<
      readonly [
        z.ZodObject<
          {
            node: z.ZodType<
              import("../../contract/schemas").NodeOutput,
              unknown,
              z.core.$ZodTypeInternals<import("../../contract/schemas").NodeOutput, unknown>
            >;
            asset: z.ZodObject<
              {
                id: z.ZodString;
                attachmentId: z.ZodString;
                name: z.ZodString;
                contentKind: z.ZodEnum<{
                  binary: "binary";
                  text: "text";
                }>;
                metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
                fileName: z.ZodString;
                mimeType: z.ZodString;
                size: z.ZodNumber;
                url: z.ZodString;
                contentHash: z.ZodNullable<z.ZodString>;
                usageCount: z.ZodNumber;
                textStatus: z.ZodEnum<{
                  missing: "missing";
                  none: "none";
                  present: "present";
                  stale: "stale";
                }>;
                createdAt: z.ZodString;
              },
              z.core.$strip
            >;
            materialized: z.ZodLiteral<true>;
          },
          z.core.$strip
        >,
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
              z.ZodType<
                import("../../contract/schemas").NodeOutput,
                unknown,
                z.core.$ZodTypeInternals<import("../../contract/schemas").NodeOutput, unknown>
              >
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
            materialized: z.ZodLiteral<false>;
          },
          z.core.$strip
        >,
      ]
    >,
    Record<never, never>,
    Record<never, never>
  >;
};
