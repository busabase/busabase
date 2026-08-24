import { z } from "zod";
export declare const fieldNameSchema: z.ZodUnion<
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
export declare const fieldTypeSchema: z.ZodEnum<{
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
/**
 * Rollup functions a `lookup` field can apply to the values it pulls across a
 * relation. `values` is the plain lookup (bring the linked records' values over
 * as-is); everything else aggregates them into a single scalar.
 *
 * Deliberately narrower than Airtable/Vika's ~15 — every entry here is actually
 * implemented. A rollup that would silently degrade to a raw array is worse than
 * one that was never offered.
 */
export declare const lookupRollupSchema: z.ZodDefault<
  z.ZodEnum<{
    average: "average";
    concatenate: "concatenate";
    count: "count";
    max: "max";
    min: "min";
    sum: "sum";
    values: "values";
  }>
>;
export declare const fieldOptionsSchema: z.ZodDefault<
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
export declare const baseFieldSchema: z.ZodObject<
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
>;
export declare const baseSchema: z.ZodObject<
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
export declare const createBaseInputSchema: z.ZodObject<
  {
    parentNodeId: z.ZodOptional<z.ZodString>;
    slug: z.ZodString;
    name: z.ZodString;
    description: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    fields: z.ZodDefault<
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
            required: z.ZodDefault<z.ZodBoolean>;
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
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const createBaseFieldInputSchema: z.ZodObject<
  {
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
    slug: z.ZodString;
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
>;
export declare const createFieldChangeRequestInputSchema: z.ZodObject<
  {
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
    slug: z.ZodString;
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
    message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const deleteFieldChangeRequestInputSchema: z.ZodObject<
  {
    fieldId: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodLiteral<false>>;
  },
  z.core.$strip
>;
export declare const updateFieldChangeRequestInputSchema: z.ZodObject<
  {
    fieldId: z.ZodString;
    patch: z.ZodObject<
      {
        name: z.ZodOptional<
          z.ZodUnion<
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
          >
        >;
        required: z.ZodOptional<z.ZodBoolean>;
        options: z.ZodOptional<
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
        >;
      },
      z.core.$strip
    >;
    message: z.ZodOptional<z.ZodString>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const previewFieldConversionInputSchema: z.ZodObject<
  {
    fieldId: z.ZodString;
    newType: z.ZodEnum<{
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
  },
  z.core.$strip
>;
export declare const previewFieldConversionOutputSchema: z.ZodObject<
  {
    totalCount: z.ZodNumber;
    convertibleCount: z.ZodNumber;
    nullCount: z.ZodNumber;
    conflicts: z.ZodArray<
      z.ZodObject<
        {
          recordId: z.ZodString;
          currentValue: z.ZodUnknown;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const convertFieldChangeRequestInputSchema: z.ZodObject<
  {
    fieldId: z.ZodString;
    newType: z.ZodEnum<{
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
    selectChoiceMode: z.ZodDefault<
      z.ZodEnum<{
        auto_create: "auto_create";
        null_on_missing: "null_on_missing";
      }>
    >;
    message: z.ZodOptional<z.ZodString>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodLiteral<false>>;
  },
  z.core.$strip
>;
export declare const reorderFieldsChangeRequestInputSchema: z.ZodObject<
  {
    fieldIds: z.ZodArray<z.ZodString>;
    message: z.ZodOptional<z.ZodString>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const archiveBaseInputSchema: z.ZodObject<
  {
    message: z.ZodOptional<z.ZodString>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodLiteral<false>>;
  },
  z.core.$strip
>;
export declare const restoreBaseInputSchema: z.ZodObject<
  {
    message: z.ZodOptional<z.ZodString>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const restoreFieldChangeRequestInputSchema: z.ZodObject<
  {
    fieldId: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const fieldChangeRequestInputSchema: z.ZodDiscriminatedUnion<
  [
    z.ZodObject<
      {
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
        slug: z.ZodString;
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
        message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        autoMerge: z.ZodOptional<z.ZodBoolean>;
        baseId: z.ZodString;
        operation: z.ZodLiteral<"create">;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        fieldId: z.ZodString;
        patch: z.ZodObject<
          {
            name: z.ZodOptional<
              z.ZodUnion<
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
              >
            >;
            required: z.ZodOptional<z.ZodBoolean>;
            options: z.ZodOptional<
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
            >;
          },
          z.core.$strip
        >;
        message: z.ZodOptional<z.ZodString>;
        submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        autoMerge: z.ZodOptional<z.ZodBoolean>;
        baseId: z.ZodString;
        operation: z.ZodLiteral<"update">;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        fieldId: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
        submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        autoMerge: z.ZodOptional<z.ZodLiteral<false>>;
        baseId: z.ZodString;
        operation: z.ZodLiteral<"delete">;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        fieldId: z.ZodString;
        newType: z.ZodEnum<{
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
        selectChoiceMode: z.ZodDefault<
          z.ZodEnum<{
            auto_create: "auto_create";
            null_on_missing: "null_on_missing";
          }>
        >;
        message: z.ZodOptional<z.ZodString>;
        submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        autoMerge: z.ZodOptional<z.ZodLiteral<false>>;
        baseId: z.ZodString;
        operation: z.ZodLiteral<"convert">;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        fieldIds: z.ZodArray<z.ZodString>;
        message: z.ZodOptional<z.ZodString>;
        submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        autoMerge: z.ZodOptional<z.ZodBoolean>;
        baseId: z.ZodString;
        operation: z.ZodLiteral<"reorder">;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        fieldId: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
        submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        autoMerge: z.ZodOptional<z.ZodBoolean>;
        baseId: z.ZodString;
        operation: z.ZodLiteral<"restore">;
      },
      z.core.$strip
    >,
  ],
  "operation"
>;
/**
 * Moving a Base between its lifecycle states, in one shape. Archive and restore
 * used to be two endpoints whose only difference was the verb in the middle of
 * the path — byte-identical payloads, the same `changeRequest` response, the
 * same API-key level. The variation is which direction the Base is moving,
 * which is what the discriminant carries.
 */
export declare const baseLifecycleChangeRequestInputSchema: z.ZodDiscriminatedUnion<
  [
    z.ZodObject<
      {
        message: z.ZodOptional<z.ZodString>;
        submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        autoMerge: z.ZodOptional<z.ZodLiteral<false>>;
        baseId: z.ZodString;
        operation: z.ZodLiteral<"archive">;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        message: z.ZodOptional<z.ZodString>;
        submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        autoMerge: z.ZodOptional<z.ZodBoolean>;
        baseId: z.ZodString;
        operation: z.ZodLiteral<"restore">;
      },
      z.core.$strip
    >,
  ],
  "operation"
>;
