import { z } from "zod";
/**
 * One input-to-field mapping. `inputName` is the name the agent-authored page
 * uses for a control; `fieldSlug` is the target Base field it writes to.
 * `required`/`label`/`help` are per-form overrides that DON'T mutate the Base
 * field definition (fixing APITable's "form not self-contained" limitation).
 */
export declare const FormFieldBindingSchema: z.ZodObject<
  {
    inputName: z.ZodString;
    fieldSlug: z.ZodString;
    required: z.ZodOptional<z.ZodBoolean>;
    label: z.ZodOptional<z.ZodString>;
    help: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export type FormFieldBindingVO = z.infer<typeof FormFieldBindingSchema>;
/**
 * Client-safe control metadata for one bound Base field. Public Forms expose
 * only these curated fields, never the target Base or its records.
 */
export declare const FormBoundFieldSchema: z.ZodObject<
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
>;
export type FormBoundFieldVO = z.infer<typeof FormBoundFieldSchema>;
/** Optional theme tokens layered over the agent-authored page. */
export declare const FormThemeSchema: z.ZodObject<
  {
    logoUrl: z.ZodOptional<z.ZodString>;
    coverUrl: z.ZodOptional<z.ZodString>;
    brandColor: z.ZodOptional<z.ZodString>;
    hideBranding: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export type FormThemeVO = z.infer<typeof FormThemeSchema>;
/**
 * Page source: ONE HTML document the agent authors — `<style>`/`<script>` live
 * inside it, exactly as a real web page does. (This was briefly split into
 * html/css/js, but the renderer only ever concatenated the parts back into a
 * single document and no step needed them apart — the split was ceremony.)
 * Block-drag authoring is intentionally NOT built; the agent writes code.
 */
export declare const FormPageSourceSchema: z.ZodObject<
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
export type FormPageSourceVO = z.infer<typeof FormPageSourceSchema>;
/**
 * Public/anonymous settings. No shareToken — the submit endpoint gates on these
 * flags. Three states: private / public+anonymous / public+require-login.
 */
export declare const FormShareSchema: z.ZodObject<
  {
    isPublic: z.ZodDefault<z.ZodBoolean>;
    anonymousSubmit: z.ZodDefault<z.ZodBoolean>;
    submitLimit: z.ZodOptional<z.ZodNumber>;
    requireCaptcha: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export type FormShareVO = z.infer<typeof FormShareSchema>;
export declare const FormVOSchema: z.ZodObject<
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
>;
export type FormVO = z.infer<typeof FormVOSchema>;
export declare const ListFormsInputSchema: z.ZodObject<
  {
    targetBaseId: z.ZodString;
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    cursor: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export type ListFormsDTO = z.infer<typeof ListFormsInputSchema>;
export declare const ListFormsVOSchema: z.ZodObject<
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
>;
export type ListFormsVO = z.infer<typeof ListFormsVOSchema>;
export declare const CreateFormInputSchema: z.ZodObject<
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
>;
export type CreateFormDTO = z.input<typeof CreateFormInputSchema>;
export declare const UpdateFormInputSchema: z.ZodObject<
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
  },
  z.core.$strip
>;
export type UpdateFormDTO = z.input<typeof UpdateFormInputSchema>;
/** A filled-in submission: input names → values, plus optional anti-abuse token. */
export declare const SubmitFormInputSchema: z.ZodObject<
  {
    values: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    captchaToken: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export type SubmitFormDTO = z.input<typeof SubmitFormInputSchema>;
/** What the submit endpoint returns — the pending ChangeRequest id, never data. */
export declare const FormSubmitResultSchema: z.ZodObject<
  {
    changeRequestId: z.ZodString;
    status: z.ZodLiteral<"pending_review">;
  },
  z.core.$strip
>;
export type FormSubmitResultVO = z.infer<typeof FormSubmitResultSchema>;
