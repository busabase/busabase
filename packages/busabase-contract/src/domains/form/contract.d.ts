import { z } from "zod";
export declare const formContract: {
  list: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodObject<
      {
        targetBaseId: z.ZodString;
        limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
        cursor: z.ZodOptional<z.ZodString>;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        forms: z.ZodArray<
          z.ZodObject<
            {
              id: z.ZodString;
              nodeId: z.ZodString;
              spaceId: z.ZodString;
              targetBaseId: z.ZodString;
              name: z.ZodString;
              description: z.ZodString;
              bindings: z.ZodArray<
                z.ZodObject<
                  {
                    inputName: z.ZodString;
                    fieldSlug: z.ZodString;
                    required: z.ZodOptional<z.ZodBoolean>;
                    label: z.ZodOptional<z.ZodString>;
                    help: z.ZodOptional<z.ZodString>;
                  },
                  z.core.$strip
                >
              >;
              boundFields: z.ZodDefault<
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
                      choices: z.ZodDefault<
                        z.ZodArray<
                          z.ZodObject<
                            {
                              id: z.ZodString;
                              name: z.ZodString;
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
              page: z.ZodObject<
                {
                  code: z.ZodOptional<z.ZodString>;
                  theme: z.ZodOptional<
                    z.ZodObject<
                      {
                        logoUrl: z.ZodOptional<z.ZodString>;
                        coverUrl: z.ZodOptional<z.ZodString>;
                        brandColor: z.ZodOptional<z.ZodString>;
                        hideBranding: z.ZodOptional<z.ZodBoolean>;
                      },
                      z.core.$strip
                    >
                  >;
                },
                z.core.$strip
              >;
              share: z.ZodObject<
                {
                  isPublic: z.ZodDefault<z.ZodBoolean>;
                  anonymousSubmit: z.ZodDefault<z.ZodBoolean>;
                  submitLimit: z.ZodOptional<z.ZodNumber>;
                  requireCaptcha: z.ZodOptional<z.ZodBoolean>;
                },
                z.core.$strip
              >;
              submissionCount: z.ZodDefault<z.ZodNumber>;
              status: z.ZodEnum<{
                active: "active";
                archived: "archived";
              }>;
              createdBy: z.ZodString;
              createdAt: z.ZodString;
              updatedAt: z.ZodString;
            },
            z.core.$strip
          >
        >;
        nextCursor: z.ZodNullable<z.ZodString>;
      },
      z.core.$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
  getByNode: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodObject<
      {
        nodeId: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        id: z.ZodString;
        nodeId: z.ZodString;
        spaceId: z.ZodString;
        targetBaseId: z.ZodString;
        name: z.ZodString;
        description: z.ZodString;
        bindings: z.ZodArray<
          z.ZodObject<
            {
              inputName: z.ZodString;
              fieldSlug: z.ZodString;
              required: z.ZodOptional<z.ZodBoolean>;
              label: z.ZodOptional<z.ZodString>;
              help: z.ZodOptional<z.ZodString>;
            },
            z.core.$strip
          >
        >;
        boundFields: z.ZodDefault<
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
                choices: z.ZodDefault<
                  z.ZodArray<
                    z.ZodObject<
                      {
                        id: z.ZodString;
                        name: z.ZodString;
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
        page: z.ZodObject<
          {
            code: z.ZodOptional<z.ZodString>;
            theme: z.ZodOptional<
              z.ZodObject<
                {
                  logoUrl: z.ZodOptional<z.ZodString>;
                  coverUrl: z.ZodOptional<z.ZodString>;
                  brandColor: z.ZodOptional<z.ZodString>;
                  hideBranding: z.ZodOptional<z.ZodBoolean>;
                },
                z.core.$strip
              >
            >;
          },
          z.core.$strip
        >;
        share: z.ZodObject<
          {
            isPublic: z.ZodDefault<z.ZodBoolean>;
            anonymousSubmit: z.ZodDefault<z.ZodBoolean>;
            submitLimit: z.ZodOptional<z.ZodNumber>;
            requireCaptcha: z.ZodOptional<z.ZodBoolean>;
          },
          z.core.$strip
        >;
        submissionCount: z.ZodDefault<z.ZodNumber>;
        status: z.ZodEnum<{
          active: "active";
          archived: "archived";
        }>;
        createdBy: z.ZodString;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
      },
      z.core.$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
  create: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodObject<
      {
        nodeId: z.ZodString;
        targetBaseId: z.ZodString;
        name: z.ZodString;
        description: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        bindings: z.ZodDefault<
          z.ZodOptional<
            z.ZodArray<
              z.ZodObject<
                {
                  inputName: z.ZodString;
                  fieldSlug: z.ZodString;
                  required: z.ZodOptional<z.ZodBoolean>;
                  label: z.ZodOptional<z.ZodString>;
                  help: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >
            >
          >
        >;
        page: z.ZodDefault<
          z.ZodOptional<
            z.ZodObject<
              {
                code: z.ZodOptional<z.ZodString>;
                theme: z.ZodOptional<
                  z.ZodObject<
                    {
                      logoUrl: z.ZodOptional<z.ZodString>;
                      coverUrl: z.ZodOptional<z.ZodString>;
                      brandColor: z.ZodOptional<z.ZodString>;
                      hideBranding: z.ZodOptional<z.ZodBoolean>;
                    },
                    z.core.$strip
                  >
                >;
              },
              z.core.$strip
            >
          >
        >;
        share: z.ZodDefault<
          z.ZodOptional<
            z.ZodObject<
              {
                isPublic: z.ZodDefault<z.ZodBoolean>;
                anonymousSubmit: z.ZodDefault<z.ZodBoolean>;
                submitLimit: z.ZodOptional<z.ZodNumber>;
                requireCaptcha: z.ZodOptional<z.ZodBoolean>;
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
        id: z.ZodString;
        nodeId: z.ZodString;
        spaceId: z.ZodString;
        targetBaseId: z.ZodString;
        name: z.ZodString;
        description: z.ZodString;
        bindings: z.ZodArray<
          z.ZodObject<
            {
              inputName: z.ZodString;
              fieldSlug: z.ZodString;
              required: z.ZodOptional<z.ZodBoolean>;
              label: z.ZodOptional<z.ZodString>;
              help: z.ZodOptional<z.ZodString>;
            },
            z.core.$strip
          >
        >;
        boundFields: z.ZodDefault<
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
                choices: z.ZodDefault<
                  z.ZodArray<
                    z.ZodObject<
                      {
                        id: z.ZodString;
                        name: z.ZodString;
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
        page: z.ZodObject<
          {
            code: z.ZodOptional<z.ZodString>;
            theme: z.ZodOptional<
              z.ZodObject<
                {
                  logoUrl: z.ZodOptional<z.ZodString>;
                  coverUrl: z.ZodOptional<z.ZodString>;
                  brandColor: z.ZodOptional<z.ZodString>;
                  hideBranding: z.ZodOptional<z.ZodBoolean>;
                },
                z.core.$strip
              >
            >;
          },
          z.core.$strip
        >;
        share: z.ZodObject<
          {
            isPublic: z.ZodDefault<z.ZodBoolean>;
            anonymousSubmit: z.ZodDefault<z.ZodBoolean>;
            submitLimit: z.ZodOptional<z.ZodNumber>;
            requireCaptcha: z.ZodOptional<z.ZodBoolean>;
          },
          z.core.$strip
        >;
        submissionCount: z.ZodDefault<z.ZodNumber>;
        status: z.ZodEnum<{
          active: "active";
          archived: "archived";
        }>;
        createdBy: z.ZodString;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
      },
      z.core.$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
  update: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodObject<
      {
        name: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        bindings: z.ZodOptional<
          z.ZodArray<
            z.ZodObject<
              {
                inputName: z.ZodString;
                fieldSlug: z.ZodString;
                required: z.ZodOptional<z.ZodBoolean>;
                label: z.ZodOptional<z.ZodString>;
                help: z.ZodOptional<z.ZodString>;
              },
              z.core.$strip
            >
          >
        >;
        page: z.ZodOptional<
          z.ZodObject<
            {
              code: z.ZodOptional<z.ZodString>;
              theme: z.ZodOptional<
                z.ZodObject<
                  {
                    logoUrl: z.ZodOptional<z.ZodString>;
                    coverUrl: z.ZodOptional<z.ZodString>;
                    brandColor: z.ZodOptional<z.ZodString>;
                    hideBranding: z.ZodOptional<z.ZodBoolean>;
                  },
                  z.core.$strip
                >
              >;
            },
            z.core.$strip
          >
        >;
        share: z.ZodOptional<
          z.ZodObject<
            {
              isPublic: z.ZodDefault<z.ZodBoolean>;
              anonymousSubmit: z.ZodDefault<z.ZodBoolean>;
              submitLimit: z.ZodOptional<z.ZodNumber>;
              requireCaptcha: z.ZodOptional<z.ZodBoolean>;
            },
            z.core.$strip
          >
        >;
        nodeId: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        id: z.ZodString;
        nodeId: z.ZodString;
        spaceId: z.ZodString;
        targetBaseId: z.ZodString;
        name: z.ZodString;
        description: z.ZodString;
        bindings: z.ZodArray<
          z.ZodObject<
            {
              inputName: z.ZodString;
              fieldSlug: z.ZodString;
              required: z.ZodOptional<z.ZodBoolean>;
              label: z.ZodOptional<z.ZodString>;
              help: z.ZodOptional<z.ZodString>;
            },
            z.core.$strip
          >
        >;
        boundFields: z.ZodDefault<
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
                choices: z.ZodDefault<
                  z.ZodArray<
                    z.ZodObject<
                      {
                        id: z.ZodString;
                        name: z.ZodString;
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
        page: z.ZodObject<
          {
            code: z.ZodOptional<z.ZodString>;
            theme: z.ZodOptional<
              z.ZodObject<
                {
                  logoUrl: z.ZodOptional<z.ZodString>;
                  coverUrl: z.ZodOptional<z.ZodString>;
                  brandColor: z.ZodOptional<z.ZodString>;
                  hideBranding: z.ZodOptional<z.ZodBoolean>;
                },
                z.core.$strip
              >
            >;
          },
          z.core.$strip
        >;
        share: z.ZodObject<
          {
            isPublic: z.ZodDefault<z.ZodBoolean>;
            anonymousSubmit: z.ZodDefault<z.ZodBoolean>;
            submitLimit: z.ZodOptional<z.ZodNumber>;
            requireCaptcha: z.ZodOptional<z.ZodBoolean>;
          },
          z.core.$strip
        >;
        submissionCount: z.ZodDefault<z.ZodNumber>;
        status: z.ZodEnum<{
          active: "active";
          archived: "archived";
        }>;
        createdBy: z.ZodString;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
      },
      z.core.$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
  submit: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodObject<
      {
        values: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        captchaToken: z.ZodOptional<z.ZodString>;
        nodeId: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        changeRequestId: z.ZodString;
        status: z.ZodLiteral<"pending_review">;
      },
      z.core.$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
};
