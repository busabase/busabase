import { z } from "zod";
export declare const viewFilterOperatorSchema: z.ZodEnum<{
  contains: "contains";
  equals: "equals";
  is_empty: "is_empty";
  is_false: "is_false";
  is_true: "is_true";
  not_empty: "not_empty";
}>;
export declare const viewFilterSchema: z.ZodObject<
  {
    fieldSlug: z.ZodString;
    fieldId: z.ZodOptional<z.ZodString>;
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
export declare const viewSortSchema: z.ZodObject<
  {
    direction: z.ZodEnum<{
      asc: "asc";
      desc: "desc";
    }>;
    fieldSlug: z.ZodString;
    fieldId: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export declare const viewTypeSchema: z.ZodEnum<{
  calendar: "calendar";
  gallery: "gallery";
  gantt: "gantt";
  kanban: "kanban";
  table: "table";
}>;
export type ViewType = z.infer<typeof viewTypeSchema>;
export declare const ganttScaleSchema: z.ZodEnum<{
  month: "month";
  week: "week";
}>;
export declare const galleryCoverFitSchema: z.ZodEnum<{
  cover: "cover";
  fit: "fit";
}>;
export declare const galleryCardSizeSchema: z.ZodEnum<{
  large: "large";
  medium: "medium";
  small: "small";
}>;
export declare const viewConfigSchema: z.ZodObject<
  {
    filters: z.ZodDefault<
      z.ZodArray<
        z.ZodObject<
          {
            fieldSlug: z.ZodString;
            fieldId: z.ZodOptional<z.ZodString>;
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
    sorts: z.ZodDefault<
      z.ZodArray<
        z.ZodObject<
          {
            direction: z.ZodEnum<{
              asc: "asc";
              desc: "desc";
            }>;
            fieldSlug: z.ZodString;
            fieldId: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >
      >
    >;
    visibleFieldSlugs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    fieldWidths: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    coverFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    coverFit: z.ZodOptional<
      z.ZodEnum<{
        cover: "cover";
        fit: "fit";
      }>
    >;
    cardSize: z.ZodOptional<
      z.ZodEnum<{
        large: "large";
        medium: "medium";
        small: "small";
      }>
    >;
    showFieldLabels: z.ZodOptional<z.ZodBoolean>;
    stackByFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    dateFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    startFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    endFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    ganttScale: z.ZodOptional<
      z.ZodEnum<{
        month: "month";
        week: "week";
      }>
    >;
  },
  z.core.$strip
>;
export declare const viewSchema: z.ZodObject<
  {
    id: z.ZodString;
    baseId: z.ZodString;
    slug: z.ZodString;
    name: z.ZodString;
    description: z.ZodString;
    type: z.ZodEnum<{
      calendar: "calendar";
      gallery: "gallery";
      gantt: "gantt";
      kanban: "kanban";
      table: "table";
    }>;
    config: z.ZodObject<
      {
        filters: z.ZodDefault<
          z.ZodArray<
            z.ZodObject<
              {
                fieldSlug: z.ZodString;
                fieldId: z.ZodOptional<z.ZodString>;
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
        sorts: z.ZodDefault<
          z.ZodArray<
            z.ZodObject<
              {
                direction: z.ZodEnum<{
                  asc: "asc";
                  desc: "desc";
                }>;
                fieldSlug: z.ZodString;
                fieldId: z.ZodOptional<z.ZodString>;
              },
              z.core.$strip
            >
          >
        >;
        visibleFieldSlugs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
        fieldWidths: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        coverFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        coverFit: z.ZodOptional<
          z.ZodEnum<{
            cover: "cover";
            fit: "fit";
          }>
        >;
        cardSize: z.ZodOptional<
          z.ZodEnum<{
            large: "large";
            medium: "medium";
            small: "small";
          }>
        >;
        showFieldLabels: z.ZodOptional<z.ZodBoolean>;
        stackByFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        dateFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        startFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        endFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        ganttScale: z.ZodOptional<
          z.ZodEnum<{
            month: "month";
            week: "week";
          }>
        >;
      },
      z.core.$strip
    >;
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
  },
  z.core.$strip
>;
export declare const createViewInputSchema: z.ZodObject<
  {
    config: z.ZodDefault<
      z.ZodOptional<
        z.ZodObject<
          {
            filters: z.ZodDefault<
              z.ZodArray<
                z.ZodObject<
                  {
                    fieldSlug: z.ZodString;
                    fieldId: z.ZodOptional<z.ZodString>;
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
            sorts: z.ZodDefault<
              z.ZodArray<
                z.ZodObject<
                  {
                    direction: z.ZodEnum<{
                      asc: "asc";
                      desc: "desc";
                    }>;
                    fieldSlug: z.ZodString;
                    fieldId: z.ZodOptional<z.ZodString>;
                  },
                  z.core.$strip
                >
              >
            >;
            visibleFieldSlugs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
            fieldWidths: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
            coverFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            coverFit: z.ZodOptional<
              z.ZodEnum<{
                cover: "cover";
                fit: "fit";
              }>
            >;
            cardSize: z.ZodOptional<
              z.ZodEnum<{
                large: "large";
                medium: "medium";
                small: "small";
              }>
            >;
            showFieldLabels: z.ZodOptional<z.ZodBoolean>;
            stackByFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            dateFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            startFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            endFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            ganttScale: z.ZodOptional<
              z.ZodEnum<{
                month: "month";
                week: "week";
              }>
            >;
          },
          z.core.$strip
        >
      >
    >;
    description: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    name: z.ZodString;
    type: z.ZodDefault<
      z.ZodOptional<
        z.ZodEnum<{
          calendar: "calendar";
          gallery: "gallery";
          gantt: "gantt";
          kanban: "kanban";
          table: "table";
        }>
      >
    >;
    slug: z.ZodOptional<z.ZodString>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const updateViewInputSchema: z.ZodObject<
  {
    config: z.ZodOptional<
      z.ZodObject<
        {
          filters: z.ZodDefault<
            z.ZodArray<
              z.ZodObject<
                {
                  fieldSlug: z.ZodString;
                  fieldId: z.ZodOptional<z.ZodString>;
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
          sorts: z.ZodDefault<
            z.ZodArray<
              z.ZodObject<
                {
                  direction: z.ZodEnum<{
                    asc: "asc";
                    desc: "desc";
                  }>;
                  fieldSlug: z.ZodString;
                  fieldId: z.ZodOptional<z.ZodString>;
                },
                z.core.$strip
              >
            >
          >;
          visibleFieldSlugs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
          fieldWidths: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
          coverFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
          coverFit: z.ZodOptional<
            z.ZodEnum<{
              cover: "cover";
              fit: "fit";
            }>
          >;
          cardSize: z.ZodOptional<
            z.ZodEnum<{
              large: "large";
              medium: "medium";
              small: "small";
            }>
          >;
          showFieldLabels: z.ZodOptional<z.ZodBoolean>;
          stackByFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
          dateFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
          startFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
          endFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
          ganttScale: z.ZodOptional<
            z.ZodEnum<{
              month: "month";
              week: "week";
            }>
          >;
        },
        z.core.$strip
      >
    >;
    description: z.ZodOptional<z.ZodString>;
    message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    name: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<
      z.ZodEnum<{
        calendar: "calendar";
        gallery: "gallery";
        gantt: "gantt";
        kanban: "kanban";
        table: "table";
      }>
    >;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const deleteViewInputSchema: z.ZodObject<
  {
    message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const restoreViewInputSchema: z.ZodObject<
  {
    message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
/**
 * Every view change request in one shape. `create` is addressed by `baseId`
 * (there is no view id yet) and the rest by `viewId` — that difference is why
 * these used to live on two different route prefixes, but it is a property of
 * the payload, not of the operation being performed.
 */
export declare const viewChangeRequestInputSchema: z.ZodDiscriminatedUnion<
  [
    z.ZodObject<
      {
        config: z.ZodDefault<
          z.ZodOptional<
            z.ZodObject<
              {
                filters: z.ZodDefault<
                  z.ZodArray<
                    z.ZodObject<
                      {
                        fieldSlug: z.ZodString;
                        fieldId: z.ZodOptional<z.ZodString>;
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
                sorts: z.ZodDefault<
                  z.ZodArray<
                    z.ZodObject<
                      {
                        direction: z.ZodEnum<{
                          asc: "asc";
                          desc: "desc";
                        }>;
                        fieldSlug: z.ZodString;
                        fieldId: z.ZodOptional<z.ZodString>;
                      },
                      z.core.$strip
                    >
                  >
                >;
                visibleFieldSlugs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
                fieldWidths: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
                coverFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                coverFit: z.ZodOptional<
                  z.ZodEnum<{
                    cover: "cover";
                    fit: "fit";
                  }>
                >;
                cardSize: z.ZodOptional<
                  z.ZodEnum<{
                    large: "large";
                    medium: "medium";
                    small: "small";
                  }>
                >;
                showFieldLabels: z.ZodOptional<z.ZodBoolean>;
                stackByFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                dateFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                startFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                endFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                ganttScale: z.ZodOptional<
                  z.ZodEnum<{
                    month: "month";
                    week: "week";
                  }>
                >;
              },
              z.core.$strip
            >
          >
        >;
        description: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        name: z.ZodString;
        type: z.ZodDefault<
          z.ZodOptional<
            z.ZodEnum<{
              calendar: "calendar";
              gallery: "gallery";
              gantt: "gantt";
              kanban: "kanban";
              table: "table";
            }>
          >
        >;
        slug: z.ZodOptional<z.ZodString>;
        submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        autoMerge: z.ZodOptional<z.ZodBoolean>;
        operation: z.ZodLiteral<"create">;
        baseId: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        config: z.ZodOptional<
          z.ZodObject<
            {
              filters: z.ZodDefault<
                z.ZodArray<
                  z.ZodObject<
                    {
                      fieldSlug: z.ZodString;
                      fieldId: z.ZodOptional<z.ZodString>;
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
              sorts: z.ZodDefault<
                z.ZodArray<
                  z.ZodObject<
                    {
                      direction: z.ZodEnum<{
                        asc: "asc";
                        desc: "desc";
                      }>;
                      fieldSlug: z.ZodString;
                      fieldId: z.ZodOptional<z.ZodString>;
                    },
                    z.core.$strip
                  >
                >
              >;
              visibleFieldSlugs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
              fieldWidths: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
              coverFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
              coverFit: z.ZodOptional<
                z.ZodEnum<{
                  cover: "cover";
                  fit: "fit";
                }>
              >;
              cardSize: z.ZodOptional<
                z.ZodEnum<{
                  large: "large";
                  medium: "medium";
                  small: "small";
                }>
              >;
              showFieldLabels: z.ZodOptional<z.ZodBoolean>;
              stackByFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
              dateFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
              startFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
              endFieldSlug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
              ganttScale: z.ZodOptional<
                z.ZodEnum<{
                  month: "month";
                  week: "week";
                }>
              >;
            },
            z.core.$strip
          >
        >;
        description: z.ZodOptional<z.ZodString>;
        message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        name: z.ZodOptional<z.ZodString>;
        type: z.ZodOptional<
          z.ZodEnum<{
            calendar: "calendar";
            gallery: "gallery";
            gantt: "gantt";
            kanban: "kanban";
            table: "table";
          }>
        >;
        submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        autoMerge: z.ZodOptional<z.ZodBoolean>;
        operation: z.ZodLiteral<"update">;
        viewId: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        autoMerge: z.ZodOptional<z.ZodBoolean>;
        operation: z.ZodLiteral<"delete">;
        viewId: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        autoMerge: z.ZodOptional<z.ZodBoolean>;
        operation: z.ZodLiteral<"restore">;
        viewId: z.ZodString;
      },
      z.core.$strip
    >,
  ],
  "operation"
>;
