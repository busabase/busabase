import { z } from "zod";
export declare const WhiteboardDocumentSchema: z.ZodObject<
  {
    version: z.ZodLiteral<1>;
    elements: z.ZodDefault<z.ZodArray<z.ZodUnknown>>;
    appState: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  },
  z.core.$strip
>;
export type WhiteboardDocument = z.infer<typeof WhiteboardDocumentSchema>;
export declare const WorkflowNodeSchema: z.ZodDiscriminatedUnion<
  [
    z.ZodObject<
      {
        id: z.ZodString;
        position: z.ZodObject<
          {
            x: z.ZodNumber;
            y: z.ZodNumber;
          },
          z.core.$strip
        >;
        label: z.ZodString;
        description: z.ZodDefault<z.ZodString>;
        kind: z.ZodLiteral<"trigger">;
        eventName: z.ZodDefault<z.ZodString>;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        id: z.ZodString;
        position: z.ZodObject<
          {
            x: z.ZodNumber;
            y: z.ZodNumber;
          },
          z.core.$strip
        >;
        label: z.ZodString;
        description: z.ZodDefault<z.ZodString>;
        kind: z.ZodLiteral<"webhook">;
        method: z.ZodDefault<
          z.ZodEnum<{
            DELETE: "DELETE";
            GET: "GET";
            PATCH: "PATCH";
            POST: "POST";
            PUT: "PUT";
          }>
        >;
        url: z.ZodDefault<z.ZodString>;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        id: z.ZodString;
        position: z.ZodObject<
          {
            x: z.ZodNumber;
            y: z.ZodNumber;
          },
          z.core.$strip
        >;
        label: z.ZodString;
        description: z.ZodDefault<z.ZodString>;
        kind: z.ZodLiteral<"function">;
        webhookRuleId: z.ZodDefault<z.ZodString>;
        functionName: z.ZodDefault<z.ZodString>;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        id: z.ZodString;
        position: z.ZodObject<
          {
            x: z.ZodNumber;
            y: z.ZodNumber;
          },
          z.core.$strip
        >;
        label: z.ZodString;
        description: z.ZodDefault<z.ZodString>;
        kind: z.ZodLiteral<"condition">;
        expression: z.ZodDefault<z.ZodString>;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        id: z.ZodString;
        position: z.ZodObject<
          {
            x: z.ZodNumber;
            y: z.ZodNumber;
          },
          z.core.$strip
        >;
        label: z.ZodString;
        description: z.ZodDefault<z.ZodString>;
        kind: z.ZodLiteral<"wait">;
        duration: z.ZodDefault<z.ZodNumber>;
        unit: z.ZodDefault<
          z.ZodEnum<{
            days: "days";
            hours: "hours";
            minutes: "minutes";
          }>
        >;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        id: z.ZodString;
        position: z.ZodObject<
          {
            x: z.ZodNumber;
            y: z.ZodNumber;
          },
          z.core.$strip
        >;
        label: z.ZodString;
        description: z.ZodDefault<z.ZodString>;
        kind: z.ZodLiteral<"approval">;
        approver: z.ZodDefault<z.ZodString>;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        id: z.ZodString;
        position: z.ZodObject<
          {
            x: z.ZodNumber;
            y: z.ZodNumber;
          },
          z.core.$strip
        >;
        label: z.ZodString;
        description: z.ZodDefault<z.ZodString>;
        kind: z.ZodLiteral<"action">;
        actionName: z.ZodDefault<z.ZodString>;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        id: z.ZodString;
        position: z.ZodObject<
          {
            x: z.ZodNumber;
            y: z.ZodNumber;
          },
          z.core.$strip
        >;
        label: z.ZodString;
        description: z.ZodDefault<z.ZodString>;
        kind: z.ZodLiteral<"end">;
        outcome: z.ZodDefault<z.ZodString>;
      },
      z.core.$strip
    >,
  ],
  "kind"
>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export declare const GraphEdgeSchema: z.ZodObject<
  {
    id: z.ZodString;
    source: z.ZodString;
    target: z.ZodString;
  },
  z.core.$strip
>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export declare const WorkflowEdgeSchema: z.ZodObject<
  {
    id: z.ZodString;
    source: z.ZodString;
    target: z.ZodString;
    label: z.ZodDefault<z.ZodString>;
    outcome: z.ZodDefault<z.ZodString>;
  },
  z.core.$strip
>;
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;
export declare const WorkflowSettingsSchema: z.ZodObject<
  {
    executionMode: z.ZodDefault<
      z.ZodEnum<{
        event: "event";
        manual: "manual";
      }>
    >;
    concurrency: z.ZodDefault<z.ZodNumber>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    errorPolicy: z.ZodDefault<
      z.ZodEnum<{
        continue: "continue";
        stop: "stop";
      }>
    >;
  },
  z.core.$strip
>;
export type WorkflowSettings = z.infer<typeof WorkflowSettingsSchema>;
export declare const WorkflowDocumentSchema: z.ZodObject<
  {
    version: z.ZodLiteral<2>;
    nodes: z.ZodDefault<
      z.ZodArray<
        z.ZodDiscriminatedUnion<
          [
            z.ZodObject<
              {
                id: z.ZodString;
                position: z.ZodObject<
                  {
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                  },
                  z.core.$strip
                >;
                label: z.ZodString;
                description: z.ZodDefault<z.ZodString>;
                kind: z.ZodLiteral<"trigger">;
                eventName: z.ZodDefault<z.ZodString>;
              },
              z.core.$strip
            >,
            z.ZodObject<
              {
                id: z.ZodString;
                position: z.ZodObject<
                  {
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                  },
                  z.core.$strip
                >;
                label: z.ZodString;
                description: z.ZodDefault<z.ZodString>;
                kind: z.ZodLiteral<"webhook">;
                method: z.ZodDefault<
                  z.ZodEnum<{
                    DELETE: "DELETE";
                    GET: "GET";
                    PATCH: "PATCH";
                    POST: "POST";
                    PUT: "PUT";
                  }>
                >;
                url: z.ZodDefault<z.ZodString>;
              },
              z.core.$strip
            >,
            z.ZodObject<
              {
                id: z.ZodString;
                position: z.ZodObject<
                  {
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                  },
                  z.core.$strip
                >;
                label: z.ZodString;
                description: z.ZodDefault<z.ZodString>;
                kind: z.ZodLiteral<"function">;
                webhookRuleId: z.ZodDefault<z.ZodString>;
                functionName: z.ZodDefault<z.ZodString>;
              },
              z.core.$strip
            >,
            z.ZodObject<
              {
                id: z.ZodString;
                position: z.ZodObject<
                  {
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                  },
                  z.core.$strip
                >;
                label: z.ZodString;
                description: z.ZodDefault<z.ZodString>;
                kind: z.ZodLiteral<"condition">;
                expression: z.ZodDefault<z.ZodString>;
              },
              z.core.$strip
            >,
            z.ZodObject<
              {
                id: z.ZodString;
                position: z.ZodObject<
                  {
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                  },
                  z.core.$strip
                >;
                label: z.ZodString;
                description: z.ZodDefault<z.ZodString>;
                kind: z.ZodLiteral<"wait">;
                duration: z.ZodDefault<z.ZodNumber>;
                unit: z.ZodDefault<
                  z.ZodEnum<{
                    days: "days";
                    hours: "hours";
                    minutes: "minutes";
                  }>
                >;
              },
              z.core.$strip
            >,
            z.ZodObject<
              {
                id: z.ZodString;
                position: z.ZodObject<
                  {
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                  },
                  z.core.$strip
                >;
                label: z.ZodString;
                description: z.ZodDefault<z.ZodString>;
                kind: z.ZodLiteral<"approval">;
                approver: z.ZodDefault<z.ZodString>;
              },
              z.core.$strip
            >,
            z.ZodObject<
              {
                id: z.ZodString;
                position: z.ZodObject<
                  {
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                  },
                  z.core.$strip
                >;
                label: z.ZodString;
                description: z.ZodDefault<z.ZodString>;
                kind: z.ZodLiteral<"action">;
                actionName: z.ZodDefault<z.ZodString>;
              },
              z.core.$strip
            >,
            z.ZodObject<
              {
                id: z.ZodString;
                position: z.ZodObject<
                  {
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                  },
                  z.core.$strip
                >;
                label: z.ZodString;
                description: z.ZodDefault<z.ZodString>;
                kind: z.ZodLiteral<"end">;
                outcome: z.ZodDefault<z.ZodString>;
              },
              z.core.$strip
            >,
          ],
          "kind"
        >
      >
    >;
    edges: z.ZodDefault<
      z.ZodArray<
        z.ZodObject<
          {
            id: z.ZodString;
            source: z.ZodString;
            target: z.ZodString;
            label: z.ZodDefault<z.ZodString>;
            outcome: z.ZodDefault<z.ZodString>;
          },
          z.core.$strip
        >
      >
    >;
    settings: z.ZodDefault<
      z.ZodObject<
        {
          executionMode: z.ZodDefault<
            z.ZodEnum<{
              event: "event";
              manual: "manual";
            }>
          >;
          concurrency: z.ZodDefault<z.ZodNumber>;
          timeoutMs: z.ZodDefault<z.ZodNumber>;
          errorPolicy: z.ZodDefault<
            z.ZodEnum<{
              continue: "continue";
              stop: "stop";
            }>
          >;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export type WorkflowDocument = z.infer<typeof WorkflowDocumentSchema>;
export declare const HtmlDocumentSchema: z.ZodObject<
  {
    version: z.ZodLiteral<1>;
    source: z.ZodString;
  },
  z.core.$strip
>;
export type HtmlDocument = z.infer<typeof HtmlDocumentSchema>;
export declare const EMPTY_WHITEBOARD_DOCUMENT: WhiteboardDocument;
export declare const EMPTY_WORKFLOW_DOCUMENT: WorkflowDocument;
export declare const DEFAULT_HTML_DOCUMENT: HtmlDocument;
export declare const parseWhiteboardDocument: (value: unknown) => WhiteboardDocument;
export declare const parseWorkflowDocument: (value: unknown) => WorkflowDocument;
export declare const parseHtmlDocument: (value: unknown) => HtmlDocument;
