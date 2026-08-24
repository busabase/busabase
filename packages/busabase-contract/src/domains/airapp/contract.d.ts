import { z } from "zod";
import type { AirAppFileVO, AirAppRunnerKind, AirAppVO } from "./types";
export type { AirAppFileVO, AirAppRunnerKind, AirAppVO };
export declare const airappFileSchema: z.ZodObject<
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
>;
export declare const airappSchema: z.ZodObject<
  {
    node: z.ZodType<
      import("../../contract/schemas").NodeOutput,
      unknown,
      z.core.$ZodTypeInternals<import("../../contract/schemas").NodeOutput, unknown>
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
  },
  z.core.$strip
>;
export declare const createAirAppInputSchema: z.ZodObject<
  {
    parentNodeId: z.ZodOptional<z.ZodString>;
    slug: z.ZodString;
    name: z.ZodString;
    description: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    visibility: z.ZodDefault<
      z.ZodOptional<
        z.ZodEnum<{
          private: "private";
          public: "public";
          workspace: "workspace";
        }>
      >
    >;
    version: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    files: z.ZodDefault<
      z.ZodOptional<
        z.ZodArray<
          z.ZodUnion<
            readonly [
              z.ZodObject<
                {
                  path: z.ZodString;
                  assetId: z.ZodString;
                  displayName: z.ZodOptional<z.ZodString>;
                  mimeType: z.ZodOptional<z.ZodString>;
                },
                z.core.$strict
              >,
              z.ZodObject<
                {
                  path: z.ZodString;
                  content: z.ZodDefault<z.ZodString>;
                  mimeType: z.ZodOptional<z.ZodString>;
                },
                z.core.$strict
              >,
            ]
          >
        >
      >
    >;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
    mergeMode: z.ZodDefault<
      z.ZodOptional<
        z.ZodEnum<{
          merge: "merge";
          replace: "replace";
        }>
      >
    >;
  },
  z.core.$strip
>;
export declare const airappFileOperationInputSchema: z.ZodUnion<
  readonly [
    z.ZodObject<
      {
        kind: z.ZodEnum<{
          create: "create";
          update: "update";
        }>;
        path: z.ZodString;
        assetId: z.ZodString;
        displayName: z.ZodOptional<z.ZodString>;
        mimeType: z.ZodOptional<z.ZodString>;
        baseContentHash: z.ZodOptional<z.ZodString>;
      },
      z.core.$strict
    >,
    z.ZodObject<
      {
        kind: z.ZodEnum<{
          create: "create";
          update: "update";
        }>;
        path: z.ZodString;
        content: z.ZodString;
        mimeType: z.ZodOptional<z.ZodString>;
        baseContentHash: z.ZodOptional<z.ZodString>;
      },
      z.core.$strict
    >,
    z.ZodObject<
      {
        kind: z.ZodLiteral<"delete">;
        path: z.ZodString;
        baseContentHash: z.ZodOptional<z.ZodString>;
      },
      z.core.$strict
    >,
    z.ZodObject<
      {
        kind: z.ZodLiteral<"metadata_update">;
        metadata: z.ZodDefault<
          z.ZodObject<
            {
              entryFile: z.ZodOptional<z.ZodString>;
              visibility: z.ZodOptional<
                z.ZodEnum<{
                  private: "private";
                  public: "public";
                  workspace: "workspace";
                }>
              >;
              version: z.ZodOptional<z.ZodString>;
            },
            z.core.$strip
          >
        >;
      },
      z.core.$strict
    >,
  ]
>;
export declare const createAirAppChangeRequestInputSchema: z.ZodObject<
  {
    message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    operations: z.ZodArray<
      z.ZodUnion<
        readonly [
          z.ZodObject<
            {
              kind: z.ZodEnum<{
                create: "create";
                update: "update";
              }>;
              path: z.ZodString;
              assetId: z.ZodString;
              displayName: z.ZodOptional<z.ZodString>;
              mimeType: z.ZodOptional<z.ZodString>;
              baseContentHash: z.ZodOptional<z.ZodString>;
            },
            z.core.$strict
          >,
          z.ZodObject<
            {
              kind: z.ZodEnum<{
                create: "create";
                update: "update";
              }>;
              path: z.ZodString;
              content: z.ZodString;
              mimeType: z.ZodOptional<z.ZodString>;
              baseContentHash: z.ZodOptional<z.ZodString>;
            },
            z.core.$strict
          >,
          z.ZodObject<
            {
              kind: z.ZodLiteral<"delete">;
              path: z.ZodString;
              baseContentHash: z.ZodOptional<z.ZodString>;
            },
            z.core.$strict
          >,
          z.ZodObject<
            {
              kind: z.ZodLiteral<"metadata_update">;
              metadata: z.ZodDefault<
                z.ZodObject<
                  {
                    entryFile: z.ZodOptional<z.ZodString>;
                    visibility: z.ZodOptional<
                      z.ZodEnum<{
                        private: "private";
                        public: "public";
                        workspace: "workspace";
                      }>
                    >;
                    version: z.ZodOptional<z.ZodString>;
                  },
                  z.core.$strip
                >
              >;
            },
            z.core.$strict
          >,
        ]
      >
    >;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const airAppRunLocalInputSchema: z.ZodObject<
  {
    nodeId: z.ZodString;
    files: z.ZodRecord<z.ZodString, z.ZodString>;
    binaryFiles: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>>;
    engine: z.ZodDefault<
      z.ZodEnum<{
        local: "local";
        sandock: "sandock";
        srt: "srt";
      }>
    >;
  },
  z.core.$strip
>;
export declare const airAppRuntimeEventSchema: z.ZodDiscriminatedUnion<
  [
    z.ZodObject<
      {
        type: z.ZodLiteral<"log">;
        line: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        type: z.ZodLiteral<"installed">;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        type: z.ZodLiteral<"ready">;
        previewUrl: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        type: z.ZodLiteral<"exit">;
        code: z.ZodNullable<z.ZodNumber>;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        type: z.ZodLiteral<"error">;
        message: z.ZodString;
      },
      z.core.$strip
    >,
  ],
  "type"
>;
export type AirAppRuntimeEvent = z.infer<typeof airAppRuntimeEventSchema>;
/**
 * Ending a run is a separate call, because a run outlives the stream that
 * started it. Closing the stream means "this viewer stopped watching", which
 * must not stop anybody's app — so there has to be a way to say the other thing.
 */
export declare const airAppStopLocalInputSchema: z.ZodObject<
  {
    nodeId: z.ZodString;
  },
  z.core.$strip
>;
export declare const airAppStopLocalOutputSchema: z.ZodObject<
  {
    stopped: z.ZodBoolean;
  },
  z.core.$strip
>;
export declare const airappRuntimeContract: {
  runLocal: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodObject<
      {
        nodeId: z.ZodString;
        files: z.ZodRecord<z.ZodString, z.ZodString>;
        binaryFiles: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>>;
        engine: z.ZodDefault<
          z.ZodEnum<{
            local: "local";
            sandock: "sandock";
            srt: "srt";
          }>
        >;
      },
      z.core.$strip
    >,
    import("@orpc/contract").Schema<
      AsyncIteratorObject<
        | {
            type: "log";
            line: string;
          }
        | {
            type: "installed";
          }
        | {
            type: "ready";
            previewUrl: string;
          }
        | {
            type: "exit";
            code: number | null;
          }
        | {
            type: "error";
            message: string;
          },
        unknown,
        void
      >,
      import("@orpc/shared").AsyncIteratorClass<
        | {
            type: "log";
            line: string;
          }
        | {
            type: "installed";
          }
        | {
            type: "ready";
            previewUrl: string;
          }
        | {
            type: "exit";
            code: number | null;
          }
        | {
            type: "error";
            message: string;
          },
        unknown,
        void
      >
    >,
    Record<never, never>,
    Record<never, never>
  >;
  stopLocal: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodObject<
      {
        nodeId: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        stopped: z.ZodBoolean;
      },
      z.core.$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
};
