/**
 * Input schema for the unified node-content write — `PUT /nodes/{nodeId}/content`.
 *
 * Replaces `PUT /docs/{nodeId}/body` and `POST /docs/{nodeId}/change-requests`,
 * and gives whiteboard/workflow/html a reviewed content write for the first
 * time (previously `PATCH /nodes/{nodeId}/metadata`, which created no
 * ChangeRequest at all). See `apps/busabase/content/spec/node-content-storage.md`
 * (D2/D3) for the full design.
 *
 * `kind` is redundant with the server-resolved `busabase_nodes.type` ON PURPOSE:
 * a wrong-shaped document becomes a contract-level 400 that NAMES the mismatch
 * (rather than a generic "invalid input" from a bare union with no discriminant),
 * and it renders in OpenAPI as a `oneOf` with an explicit discriminator an agent
 * can read straight off the schema instead of trial-and-erroring shapes. The
 * server still asserts `kind` matches the resolved node's actual type — this
 * field is a contract-level ergonomics/documentation win, not a trust boundary.
 *
 * Pure zod — no db/logic/server imports (this file is pulled into the browser
 * bundle and the React Native client is generated from its type graph).
 */
import { z } from "zod";
export declare const NODE_CONTENT_TYPES: readonly ["doc", "whiteboard", "workflow", "html"];
export type NodeContentType = (typeof NODE_CONTENT_TYPES)[number];
export declare const nodeContentInputSchema: z.ZodDiscriminatedUnion<
  [
    z.ZodObject<
      {
        kind: z.ZodLiteral<"doc">;
        body: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        kind: z.ZodLiteral<"whiteboard">;
        document: z.ZodObject<
          {
            version: z.ZodLiteral<1>;
            elements: z.ZodDefault<z.ZodArray<z.ZodUnknown>>;
            appState: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
          },
          z.core.$strip
        >;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        kind: z.ZodLiteral<"workflow">;
        document: z.ZodObject<
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
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        kind: z.ZodLiteral<"html">;
        document: z.ZodObject<
          {
            version: z.ZodLiteral<1>;
            source: z.ZodString;
          },
          z.core.$strip
        >;
      },
      z.core.$strip
    >,
  ],
  "kind"
>;
export type NodeContentInput = z.infer<typeof nodeContentInputSchema>;
export declare const updateNodeContentInputSchema: z.ZodObject<
  {
    nodeId: z.ZodString;
    content: z.ZodDiscriminatedUnion<
      [
        z.ZodObject<
          {
            kind: z.ZodLiteral<"doc">;
            body: z.ZodString;
          },
          z.core.$strip
        >,
        z.ZodObject<
          {
            kind: z.ZodLiteral<"whiteboard">;
            document: z.ZodObject<
              {
                version: z.ZodLiteral<1>;
                elements: z.ZodDefault<z.ZodArray<z.ZodUnknown>>;
                appState: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
        z.ZodObject<
          {
            kind: z.ZodLiteral<"workflow">;
            document: z.ZodObject<
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
          },
          z.core.$strip
        >,
        z.ZodObject<
          {
            kind: z.ZodLiteral<"html">;
            document: z.ZodObject<
              {
                version: z.ZodLiteral<1>;
                source: z.ZodString;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
      ],
      "kind"
    >;
    message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export type UpdateNodeContentInput = z.infer<typeof updateNodeContentInputSchema>;
