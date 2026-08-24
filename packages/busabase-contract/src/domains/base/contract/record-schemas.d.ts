import { z } from "zod";
export declare const recordSchema: z.ZodObject<
  {
    id: z.ZodString;
    baseId: z.ZodString;
    headCommitId: z.ZodString;
    parentRecordId: z.ZodNullable<z.ZodString>;
    parentCommitId: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<{
      active: "active";
      archived: "archived";
    }>;
    createdBy: z.ZodString;
    createdByUser: z.ZodDefault<
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
    archivedAt: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    base: z.ZodObject<
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
    >;
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
  },
  z.core.$strip
>;
export declare const listRecordsFilterSchema: z.ZodObject<
  {
    fieldSlug: z.ZodString;
    fieldType: z.ZodOptional<z.ZodString>;
    operator: z.ZodEnum<{
      contains: "contains";
      equals: "equals";
      is_empty: "is_empty";
      is_false: "is_false";
      is_true: "is_true";
      not_empty: "not_empty";
    }>;
    value: z.ZodOptional<z.ZodUnknown>;
  },
  z.core.$strip
>;
export declare const listRecordsSortSchema: z.ZodObject<
  {
    fieldSlug: z.ZodString;
    fieldType: z.ZodOptional<z.ZodString>;
    direction: z.ZodDefault<
      z.ZodOptional<
        z.ZodEnum<{
          asc: "asc";
          desc: "desc";
        }>
      >
    >;
  },
  z.core.$strip
>;
export declare const listRecordsInputSchema: z.ZodDefault<
  z.ZodOptional<
    z.ZodObject<
      {
        limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
        baseId: z.ZodOptional<z.ZodString>;
        cursor: z.ZodOptional<z.ZodString>;
        status: z.ZodDefault<
          z.ZodOptional<
            z.ZodEnum<{
              active: "active";
              archived: "archived";
            }>
          >
        >;
        filters: z.ZodOptional<
          z.ZodArray<
            z.ZodObject<
              {
                fieldSlug: z.ZodString;
                fieldType: z.ZodOptional<z.ZodString>;
                operator: z.ZodEnum<{
                  contains: "contains";
                  equals: "equals";
                  is_empty: "is_empty";
                  is_false: "is_false";
                  is_true: "is_true";
                  not_empty: "not_empty";
                }>;
                value: z.ZodOptional<z.ZodUnknown>;
              },
              z.core.$strip
            >
          >
        >;
        sort: z.ZodOptional<
          z.ZodObject<
            {
              fieldSlug: z.ZodString;
              fieldType: z.ZodOptional<z.ZodString>;
              direction: z.ZodDefault<
                z.ZodOptional<
                  z.ZodEnum<{
                    asc: "asc";
                    desc: "desc";
                  }>
                >
              >;
            },
            z.core.$strip
          >
        >;
      },
      z.core.$strip
    >
  >
>;
export declare const listRecordsResponseSchema: z.ZodObject<
  {
    records: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          baseId: z.ZodString;
          headCommitId: z.ZodString;
          parentRecordId: z.ZodNullable<z.ZodString>;
          parentCommitId: z.ZodNullable<z.ZodString>;
          status: z.ZodEnum<{
            active: "active";
            archived: "archived";
          }>;
          createdBy: z.ZodString;
          createdByUser: z.ZodDefault<
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
          archivedAt: z.ZodNullable<z.ZodString>;
          createdAt: z.ZodString;
          updatedAt: z.ZodString;
          base: z.ZodObject<
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
          >;
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
        },
        z.core.$strip
      >
    >;
    nextCursor: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export declare const listRecordsPageInputSchema: z.ZodObject<
  {
    baseId: z.ZodString;
    viewId: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    pageSize: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
  },
  z.core.$strip
>;
export declare const listRecordsPageResponseSchema: z.ZodObject<
  {
    records: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          baseId: z.ZodString;
          headCommitId: z.ZodString;
          parentRecordId: z.ZodNullable<z.ZodString>;
          parentCommitId: z.ZodNullable<z.ZodString>;
          status: z.ZodEnum<{
            active: "active";
            archived: "archived";
          }>;
          createdBy: z.ZodString;
          createdByUser: z.ZodDefault<
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
          archivedAt: z.ZodNullable<z.ZodString>;
          createdAt: z.ZodString;
          updatedAt: z.ZodString;
          base: z.ZodObject<
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
          >;
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
export declare const countRecordsInputSchema: z.ZodDefault<
  z.ZodOptional<
    z.ZodObject<
      {
        baseId: z.ZodOptional<z.ZodString>;
        viewId: z.ZodOptional<z.ZodString>;
        filters: z.ZodOptional<
          z.ZodArray<
            z.ZodObject<
              {
                fieldSlug: z.ZodString;
                fieldType: z.ZodOptional<z.ZodString>;
                operator: z.ZodEnum<{
                  contains: "contains";
                  equals: "equals";
                  is_empty: "is_empty";
                  is_false: "is_false";
                  is_true: "is_true";
                  not_empty: "not_empty";
                }>;
                value: z.ZodOptional<z.ZodUnknown>;
              },
              z.core.$strip
            >
          >
        >;
      },
      z.core.$strip
    >
  >
>;
export declare const countRecordsResponseSchema: z.ZodObject<
  {
    total: z.ZodNumber;
  },
  z.core.$strip
>;
export declare const createChangeRequestInputSchema: z.ZodObject<
  {
    fields: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    idempotencyKey: z.ZodOptional<z.ZodString>;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const createBulkChangeRequestInputSchema: z.ZodObject<
  {
    records: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    idempotencyKey: z.ZodOptional<z.ZodString>;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const recordFieldFilterInputSchema: z.ZodObject<
  {
    baseId: z.ZodOptional<z.ZodString>;
    fieldSlug: z.ZodString;
    valueText: z.ZodString;
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
  },
  z.core.$strip
>;
export declare const recordFieldGetInputSchema: z.ZodObject<
  {
    baseId: z.ZodString;
    fieldSlug: z.ZodString;
    valueText: z.ZodString;
  },
  z.core.$strip
>;
/**
 * A record get is always a single-row lookup, addressed either by its canonical
 * id or by one exact field value within a Base. Strict branches make this a
 * real XOR at runtime: callers cannot send both selector shapes and have Zod
 * silently discard the extra keys.
 */
export declare const recordGetInputSchema: z.ZodUnion<
  readonly [
    z.ZodObject<
      {
        recordId: z.ZodString;
      },
      z.core.$strict
    >,
    z.ZodObject<
      {
        baseId: z.ZodString;
        fieldSlug: z.ZodString;
        valueText: z.ZodString;
      },
      z.core.$strict
    >,
  ]
>;
export declare const restoreRecordInputSchema: z.ZodObject<
  {
    message: z.ZodOptional<z.ZodString>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodLiteral<false>>;
  },
  z.core.$strip
>;
export declare const recordChangeRequestInputSchema: z.ZodDiscriminatedUnion<
  [
    z.ZodObject<
      {
        fields: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        author: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        baseCommitId: z.ZodOptional<z.ZodString>;
        recordId: z.ZodString;
        operation: z.ZodLiteral<"update">;
        autoMerge: z.ZodOptional<z.ZodBoolean>;
      },
      z.core.$strip
    >,
    z.ZodObject<
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
        recordId: z.ZodString;
        operation: z.ZodLiteral<"delete">;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        message: z.ZodOptional<z.ZodString>;
        submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        autoMerge: z.ZodOptional<z.ZodLiteral<false>>;
        recordId: z.ZodString;
        operation: z.ZodLiteral<"restore">;
      },
      z.core.$strip
    >,
  ],
  "operation"
>;
export declare const recordLinkSchema: z.ZodObject<
  {
    id: z.ZodString;
    baseId: z.ZodString;
    fieldId: z.ZodString;
    fieldSlug: z.ZodString;
    sourceRecordId: z.ZodString;
    targetBaseId: z.ZodString;
    targetRecordId: z.ZodString;
    commitId: z.ZodString;
    position: z.ZodNumber;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
  },
  z.core.$strip
>;
