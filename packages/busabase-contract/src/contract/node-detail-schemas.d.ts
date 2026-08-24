/**
 * Unified Node detail VO — the output of the single `GET /nodes/{nodeId}`
 * operation that replaced `docs.get`, `files.get`, `folders.get`, and
 * `fileTrees.get`.
 *
 * An agent that holds a node id should not have to discover the node's type
 * first and then pick one of four type-specific get operations. The type is a
 * property of the node, not a property of the caller's intent, so it belongs on
 * the RESPONSE as a discriminator rather than in the path.
 *
 * Backward-compatible on purpose: each variant is the exact detail VO the
 * retired operation returned, plus a top-level `type` literal. A caller that
 * already reads `.node` / `.body` / `.asset` / `.children` / `.files` keeps
 * working once it narrows on `type`.
 *
 * Pure zod — no db/logic/server imports (this file is pulled into the browser
 * bundle and the React Native client is generated from its type graph).
 */
import { z } from "zod";
/**
 * One variant per registered node type, keyed by that type.
 *
 * `satisfies Record<NodeType, unknown>` is the exhaustiveness gate: registering
 * a new first-party node type in `domains/registry.ts` without adding a variant
 * here fails `tsc` at the contract (missing key), and a variant for a type that
 * is not registered fails too (excess key). The alternative — discovering it at
 * runtime when `nodes.get` meets a node it cannot describe — is exactly the
 * "unknown node type -> malformed VO" failure this union exists to prevent.
 */
export declare const NODE_DETAIL_VARIANTS: {
  folder: z.ZodObject<
    {
      node: z.ZodType<
        import("./schemas").NodeOutput,
        unknown,
        z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
      >;
      children: z.ZodArray<
        z.ZodType<
          import("./schemas").NodeOutput,
          unknown,
          z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
        >
      >;
      type: z.ZodLiteral<"folder">;
    },
    z.core.$strip
  >;
  doc: z.ZodObject<
    {
      node: z.ZodType<
        import("./schemas").NodeOutput,
        unknown,
        z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
      >;
      storagePrefix: z.ZodString;
      body: z.ZodString;
      type: z.ZodLiteral<"doc">;
    },
    z.core.$strip
  >;
  file: z.ZodObject<
    {
      node: z.ZodType<
        import("./schemas").NodeOutput,
        unknown,
        z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
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
      type: z.ZodLiteral<"file">;
    },
    z.core.$strip
  >;
  skill: z.ZodObject<
    {
      node: z.ZodType<
        import("./schemas").NodeOutput,
        unknown,
        z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
      >;
      entryFile: z.ZodString;
      visibility: z.ZodEnum<{
        private: "private";
        public: "public";
        workspace: "workspace";
      }>;
      version: z.ZodString;
      files: z.ZodArray<
        z.ZodObject<
          {
            path: z.ZodString;
            name: z.ZodString;
            size: z.ZodNumber;
            updatedAt: z.ZodNullable<z.ZodString>;
            mimeType: z.ZodNullable<z.ZodString>;
            assetId: z.ZodString;
            displayName: z.ZodNullable<z.ZodString>;
          },
          z.core.$strip
        >
      >;
      skippedGitignorePaths: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
      type: z.ZodLiteral<"skill">;
    },
    z.core.$strip
  >;
  drive: z.ZodObject<
    {
      node: z.ZodType<
        import("./schemas").NodeOutput,
        unknown,
        z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
      >;
      entryFile: z.ZodString;
      visibility: z.ZodEnum<{
        private: "private";
        public: "public";
        workspace: "workspace";
      }>;
      version: z.ZodString;
      files: z.ZodArray<
        z.ZodObject<
          {
            path: z.ZodString;
            name: z.ZodString;
            size: z.ZodNumber;
            updatedAt: z.ZodNullable<z.ZodString>;
            mimeType: z.ZodNullable<z.ZodString>;
            assetId: z.ZodString;
            displayName: z.ZodNullable<z.ZodString>;
          },
          z.core.$strip
        >
      >;
      skippedGitignorePaths: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
      type: z.ZodLiteral<"drive">;
    },
    z.core.$strip
  >;
  airapp: z.ZodObject<
    {
      node: z.ZodType<
        import("./schemas").NodeOutput,
        unknown,
        z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
      >;
      entryFile: z.ZodString;
      visibility: z.ZodEnum<{
        private: "private";
        public: "public";
        workspace: "workspace";
      }>;
      version: z.ZodString;
      files: z.ZodArray<
        z.ZodObject<
          {
            path: z.ZodString;
            name: z.ZodString;
            size: z.ZodNumber;
            updatedAt: z.ZodNullable<z.ZodString>;
            mimeType: z.ZodNullable<z.ZodString>;
            assetId: z.ZodString;
            displayName: z.ZodNullable<z.ZodString>;
          },
          z.core.$strip
        >
      >;
      skippedGitignorePaths: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
      type: z.ZodLiteral<"airapp">;
    },
    z.core.$strip
  >;
  base: z.ZodObject<
    {
      type: z.ZodLiteral<"base">;
      node: z.ZodType<
        import("./schemas").NodeOutput,
        unknown,
        z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
      >;
    },
    z.core.$strip
  >;
  form: z.ZodObject<
    {
      type: z.ZodLiteral<"form">;
      node: z.ZodType<
        import("./schemas").NodeOutput,
        unknown,
        z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
      >;
    },
    z.core.$strip
  >;
  whiteboard: z.ZodObject<
    {
      type: z.ZodLiteral<"whiteboard">;
      node: z.ZodType<
        import("./schemas").NodeOutput,
        unknown,
        z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
      >;
      document: z.ZodType<
        {
          version: 1;
          elements: unknown[];
          appState: Record<string, unknown>;
        },
        unknown,
        z.core.$ZodTypeInternals<
          {
            version: 1;
            elements: unknown[];
            appState: Record<string, unknown>;
          },
          unknown
        >
      >;
    },
    z.core.$strip
  >;
  workflow: z.ZodObject<
    {
      type: z.ZodLiteral<"workflow">;
      node: z.ZodType<
        import("./schemas").NodeOutput,
        unknown,
        z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
      >;
      document: z.ZodType<
        {
          version: 2;
          nodes: (
            | {
                id: string;
                position: {
                  x: number;
                  y: number;
                };
                label: string;
                description: string;
                kind: "trigger";
                eventName: string;
              }
            | {
                id: string;
                position: {
                  x: number;
                  y: number;
                };
                label: string;
                description: string;
                kind: "webhook";
                method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
                url: string;
              }
            | {
                id: string;
                position: {
                  x: number;
                  y: number;
                };
                label: string;
                description: string;
                kind: "function";
                webhookRuleId: string;
                functionName: string;
              }
            | {
                id: string;
                position: {
                  x: number;
                  y: number;
                };
                label: string;
                description: string;
                kind: "condition";
                expression: string;
              }
            | {
                id: string;
                position: {
                  x: number;
                  y: number;
                };
                label: string;
                description: string;
                kind: "wait";
                duration: number;
                unit: "days" | "hours" | "minutes";
              }
            | {
                id: string;
                position: {
                  x: number;
                  y: number;
                };
                label: string;
                description: string;
                kind: "approval";
                approver: string;
              }
            | {
                id: string;
                position: {
                  x: number;
                  y: number;
                };
                label: string;
                description: string;
                kind: "action";
                actionName: string;
              }
            | {
                id: string;
                position: {
                  x: number;
                  y: number;
                };
                label: string;
                description: string;
                kind: "end";
                outcome: string;
              }
          )[];
          edges: {
            id: string;
            source: string;
            target: string;
            label: string;
            outcome: string;
          }[];
          settings: {
            executionMode: "event" | "manual";
            concurrency: number;
            timeoutMs: number;
            errorPolicy: "continue" | "stop";
          };
        },
        unknown,
        z.core.$ZodTypeInternals<
          {
            version: 2;
            nodes: (
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "trigger";
                  eventName: string;
                }
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "webhook";
                  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
                  url: string;
                }
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "function";
                  webhookRuleId: string;
                  functionName: string;
                }
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "condition";
                  expression: string;
                }
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "wait";
                  duration: number;
                  unit: "days" | "hours" | "minutes";
                }
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "approval";
                  approver: string;
                }
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "action";
                  actionName: string;
                }
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "end";
                  outcome: string;
                }
            )[];
            edges: {
              id: string;
              source: string;
              target: string;
              label: string;
              outcome: string;
            }[];
            settings: {
              executionMode: "event" | "manual";
              concurrency: number;
              timeoutMs: number;
              errorPolicy: "continue" | "stop";
            };
          },
          unknown
        >
      >;
    },
    z.core.$strip
  >;
  html: z.ZodObject<
    {
      type: z.ZodLiteral<"html">;
      node: z.ZodType<
        import("./schemas").NodeOutput,
        unknown,
        z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
      >;
      document: z.ZodType<
        {
          version: 1;
          source: string;
        },
        unknown,
        z.core.$ZodTypeInternals<
          {
            version: 1;
            source: string;
          },
          unknown
        >
      >;
    },
    z.core.$strip
  >;
};
export declare const NodeDetailVOSchema: z.ZodDiscriminatedUnion<
  [
    z.ZodObject<
      {
        node: z.ZodType<
          import("./schemas").NodeOutput,
          unknown,
          z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
        >;
        children: z.ZodArray<
          z.ZodType<
            import("./schemas").NodeOutput,
            unknown,
            z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
          >
        >;
        type: z.ZodLiteral<"folder">;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        node: z.ZodType<
          import("./schemas").NodeOutput,
          unknown,
          z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
        >;
        storagePrefix: z.ZodString;
        body: z.ZodString;
        type: z.ZodLiteral<"doc">;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        node: z.ZodType<
          import("./schemas").NodeOutput,
          unknown,
          z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
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
        type: z.ZodLiteral<"file">;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        node: z.ZodType<
          import("./schemas").NodeOutput,
          unknown,
          z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
        >;
        entryFile: z.ZodString;
        visibility: z.ZodEnum<{
          private: "private";
          public: "public";
          workspace: "workspace";
        }>;
        version: z.ZodString;
        files: z.ZodArray<
          z.ZodObject<
            {
              path: z.ZodString;
              name: z.ZodString;
              size: z.ZodNumber;
              updatedAt: z.ZodNullable<z.ZodString>;
              mimeType: z.ZodNullable<z.ZodString>;
              assetId: z.ZodString;
              displayName: z.ZodNullable<z.ZodString>;
            },
            z.core.$strip
          >
        >;
        skippedGitignorePaths: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
        type: z.ZodLiteral<"skill">;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        node: z.ZodType<
          import("./schemas").NodeOutput,
          unknown,
          z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
        >;
        entryFile: z.ZodString;
        visibility: z.ZodEnum<{
          private: "private";
          public: "public";
          workspace: "workspace";
        }>;
        version: z.ZodString;
        files: z.ZodArray<
          z.ZodObject<
            {
              path: z.ZodString;
              name: z.ZodString;
              size: z.ZodNumber;
              updatedAt: z.ZodNullable<z.ZodString>;
              mimeType: z.ZodNullable<z.ZodString>;
              assetId: z.ZodString;
              displayName: z.ZodNullable<z.ZodString>;
            },
            z.core.$strip
          >
        >;
        skippedGitignorePaths: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
        type: z.ZodLiteral<"drive">;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        node: z.ZodType<
          import("./schemas").NodeOutput,
          unknown,
          z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
        >;
        entryFile: z.ZodString;
        visibility: z.ZodEnum<{
          private: "private";
          public: "public";
          workspace: "workspace";
        }>;
        version: z.ZodString;
        files: z.ZodArray<
          z.ZodObject<
            {
              path: z.ZodString;
              name: z.ZodString;
              size: z.ZodNumber;
              updatedAt: z.ZodNullable<z.ZodString>;
              mimeType: z.ZodNullable<z.ZodString>;
              assetId: z.ZodString;
              displayName: z.ZodNullable<z.ZodString>;
            },
            z.core.$strip
          >
        >;
        skippedGitignorePaths: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
        type: z.ZodLiteral<"airapp">;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        type: z.ZodLiteral<"base">;
        node: z.ZodType<
          import("./schemas").NodeOutput,
          unknown,
          z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
        >;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        type: z.ZodLiteral<"form">;
        node: z.ZodType<
          import("./schemas").NodeOutput,
          unknown,
          z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
        >;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        type: z.ZodLiteral<"whiteboard">;
        node: z.ZodType<
          import("./schemas").NodeOutput,
          unknown,
          z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
        >;
        document: z.ZodType<
          {
            version: 1;
            elements: unknown[];
            appState: Record<string, unknown>;
          },
          unknown,
          z.core.$ZodTypeInternals<
            {
              version: 1;
              elements: unknown[];
              appState: Record<string, unknown>;
            },
            unknown
          >
        >;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        type: z.ZodLiteral<"workflow">;
        node: z.ZodType<
          import("./schemas").NodeOutput,
          unknown,
          z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
        >;
        document: z.ZodType<
          {
            version: 2;
            nodes: (
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "trigger";
                  eventName: string;
                }
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "webhook";
                  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
                  url: string;
                }
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "function";
                  webhookRuleId: string;
                  functionName: string;
                }
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "condition";
                  expression: string;
                }
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "wait";
                  duration: number;
                  unit: "days" | "hours" | "minutes";
                }
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "approval";
                  approver: string;
                }
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "action";
                  actionName: string;
                }
              | {
                  id: string;
                  position: {
                    x: number;
                    y: number;
                  };
                  label: string;
                  description: string;
                  kind: "end";
                  outcome: string;
                }
            )[];
            edges: {
              id: string;
              source: string;
              target: string;
              label: string;
              outcome: string;
            }[];
            settings: {
              executionMode: "event" | "manual";
              concurrency: number;
              timeoutMs: number;
              errorPolicy: "continue" | "stop";
            };
          },
          unknown,
          z.core.$ZodTypeInternals<
            {
              version: 2;
              nodes: (
                | {
                    id: string;
                    position: {
                      x: number;
                      y: number;
                    };
                    label: string;
                    description: string;
                    kind: "trigger";
                    eventName: string;
                  }
                | {
                    id: string;
                    position: {
                      x: number;
                      y: number;
                    };
                    label: string;
                    description: string;
                    kind: "webhook";
                    method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
                    url: string;
                  }
                | {
                    id: string;
                    position: {
                      x: number;
                      y: number;
                    };
                    label: string;
                    description: string;
                    kind: "function";
                    webhookRuleId: string;
                    functionName: string;
                  }
                | {
                    id: string;
                    position: {
                      x: number;
                      y: number;
                    };
                    label: string;
                    description: string;
                    kind: "condition";
                    expression: string;
                  }
                | {
                    id: string;
                    position: {
                      x: number;
                      y: number;
                    };
                    label: string;
                    description: string;
                    kind: "wait";
                    duration: number;
                    unit: "days" | "hours" | "minutes";
                  }
                | {
                    id: string;
                    position: {
                      x: number;
                      y: number;
                    };
                    label: string;
                    description: string;
                    kind: "approval";
                    approver: string;
                  }
                | {
                    id: string;
                    position: {
                      x: number;
                      y: number;
                    };
                    label: string;
                    description: string;
                    kind: "action";
                    actionName: string;
                  }
                | {
                    id: string;
                    position: {
                      x: number;
                      y: number;
                    };
                    label: string;
                    description: string;
                    kind: "end";
                    outcome: string;
                  }
              )[];
              edges: {
                id: string;
                source: string;
                target: string;
                label: string;
                outcome: string;
              }[];
              settings: {
                executionMode: "event" | "manual";
                concurrency: number;
                timeoutMs: number;
                errorPolicy: "continue" | "stop";
              };
            },
            unknown
          >
        >;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        type: z.ZodLiteral<"html">;
        node: z.ZodType<
          import("./schemas").NodeOutput,
          unknown,
          z.core.$ZodTypeInternals<import("./schemas").NodeOutput, unknown>
        >;
        document: z.ZodType<
          {
            version: 1;
            source: string;
          },
          unknown,
          z.core.$ZodTypeInternals<
            {
              version: 1;
              source: string;
            },
            unknown
          >
        >;
      },
      z.core.$strip
    >,
  ],
  "type"
>;
export type NodeDetailVO = z.infer<typeof NodeDetailVOSchema>;
/**
 * `nodeId` accepts a node id OR a slug — every retired typed get did. A slug is
 * only unique *within* a type, so `type` disambiguates it; a node id needs no
 * hint. An ambiguous slug with no `type` is refused rather than silently
 * resolved to whichever row sorts first.
 */
export declare const getNodeInputSchema: z.ZodObject<
  {
    nodeId: z.ZodString;
    type: z.ZodOptional<
      z.ZodEnum<{
        [x: string]: string;
      }>
    >;
  },
  z.core.$strip
>;
