import { z } from "zod";
/**
 * Embed Links CRUD (create/list/revoke) DTO + VO schemas — the single source of truth for
 * both the real absolute-path OpenAPI surface the Busabase Cloud host serves at
 * `/api/v1/embed-links` and the relative-path twin registered in `cloudContract` below (the
 * CLI/SDK client's contract, `/embed-links` + the shared `/api/v1` prefix). Two independent route
 * declarations, one shared schema set — same pattern as `system`/`users`/`agentTasks` in `cloud.ts`.
 *
 * Runtime/internal embed schemas that are NOT part of this CLI/SDK CRUD surface (node-detail
 * rendering for the embed viewer, AirApp embed runtime files, etc.) stay private to that host —
 * only the shapes `create` / `list` / `revoke` actually send or return live here.
 */
export declare const EMBED_LINK_DEFAULT_MINUTES = 15;
export declare const EMBED_LINK_MAX_MINUTES: number;
export declare const EmbedNodeTypeSchema: z.ZodEnum<{
  airapp: "airapp";
  base: "base";
  doc: "doc";
  drive: "drive";
  file: "file";
  folder: "folder";
  skill: "skill";
}>;
export type EmbedNodeType = z.infer<typeof EmbedNodeTypeSchema>;
export declare const EmbedFrameModeSchema: z.ZodEnum<{
  anywhere: "anywhere";
  origins: "origins";
  "top-level-only": "top-level-only";
}>;
export type EmbedFrameMode = z.infer<typeof EmbedFrameModeSchema>;
export declare const EmbedFramePolicyInputSchema: z.ZodPipe<
  z.ZodDiscriminatedUnion<
    [
      z.ZodObject<
        {
          mode: z.ZodLiteral<"anywhere">;
          allowedOrigins: z.ZodOptional<
            z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>
          >;
        },
        z.core.$strip
      >,
      z.ZodObject<
        {
          mode: z.ZodLiteral<"origins">;
          allowedOrigins: z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>;
        },
        z.core.$strip
      >,
      z.ZodObject<
        {
          mode: z.ZodLiteral<"top-level-only">;
          allowedOrigins: z.ZodOptional<
            z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>
          >;
        },
        z.core.$strip
      >,
    ],
    "mode"
  >,
  z.ZodTransform<
    {
      mode: "anywhere" | "origins" | "top-level-only";
      allowedOrigins: string[];
    },
    | {
        mode: "anywhere";
        allowedOrigins?: string[] | undefined;
      }
    | {
        mode: "origins";
        allowedOrigins: string[];
      }
    | {
        mode: "top-level-only";
        allowedOrigins?: string[] | undefined;
      }
  >
>;
export declare const EmbedFramePolicyVOSchema: z.ZodObject<
  {
    mode: z.ZodEnum<{
      anywhere: "anywhere";
      origins: "origins";
      "top-level-only": "top-level-only";
    }>;
    allowedOrigins: z.ZodArray<z.ZodString>;
  },
  z.core.$strip
>;
export type EmbedFramePolicyVO = z.infer<typeof EmbedFramePolicyVOSchema>;
export declare const CreateEmbedLinkInputSchema: z.ZodObject<
  {
    nodeId: z.ZodString;
    expiresInMinutes: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    framePolicy: z.ZodDefault<
      z.ZodOptional<
        z.ZodPipe<
          z.ZodDiscriminatedUnion<
            [
              z.ZodObject<
                {
                  mode: z.ZodLiteral<"anywhere">;
                  allowedOrigins: z.ZodOptional<
                    z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>
                  >;
                },
                z.core.$strip
              >,
              z.ZodObject<
                {
                  mode: z.ZodLiteral<"origins">;
                  allowedOrigins: z.ZodArray<
                    z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>
                  >;
                },
                z.core.$strip
              >,
              z.ZodObject<
                {
                  mode: z.ZodLiteral<"top-level-only">;
                  allowedOrigins: z.ZodOptional<
                    z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>
                  >;
                },
                z.core.$strip
              >,
            ],
            "mode"
          >,
          z.ZodTransform<
            {
              mode: "anywhere" | "origins" | "top-level-only";
              allowedOrigins: string[];
            },
            | {
                mode: "anywhere";
                allowedOrigins?: string[] | undefined;
              }
            | {
                mode: "origins";
                allowedOrigins: string[];
              }
            | {
                mode: "top-level-only";
                allowedOrigins?: string[] | undefined;
              }
          >
        >
      >
    >;
  },
  z.core.$strip
>;
export type CreateEmbedLinkDTO = z.infer<typeof CreateEmbedLinkInputSchema>;
export declare const ListEmbedLinksInputSchema: z.ZodDefault<
  z.ZodOptional<
    z.ZodObject<
      {
        nodeId: z.ZodOptional<z.ZodString>;
      },
      z.core.$strip
    >
  >
>;
export type ListEmbedLinksDTO = z.infer<typeof ListEmbedLinksInputSchema>;
export declare const RevokeEmbedLinkInputSchema: z.ZodObject<
  {
    id: z.ZodString;
  },
  z.core.$strip
>;
export type RevokeEmbedLinkDTO = z.infer<typeof RevokeEmbedLinkInputSchema>;
export declare const EmbedLinkVOSchema: z.ZodObject<
  {
    id: z.ZodString;
    nodeId: z.ZodString;
    nodeName: z.ZodString;
    nodeType: z.ZodEnum<{
      airapp: "airapp";
      base: "base";
      doc: "doc";
      drive: "drive";
      file: "file";
      folder: "folder";
      skill: "skill";
    }>;
    createdAt: z.ZodString;
    expiresAt: z.ZodString;
    revokedAt: z.ZodNullable<z.ZodString>;
    active: z.ZodBoolean;
    framePolicy: z.ZodObject<
      {
        mode: z.ZodEnum<{
          anywhere: "anywhere";
          origins: "origins";
          "top-level-only": "top-level-only";
        }>;
        allowedOrigins: z.ZodArray<z.ZodString>;
      },
      z.core.$strip
    >;
  },
  z.core.$strip
>;
export type EmbedLinkVO = z.infer<typeof EmbedLinkVOSchema>;
export declare const CreatedEmbedLinkVOSchema: z.ZodObject<
  {
    id: z.ZodString;
    nodeId: z.ZodString;
    nodeName: z.ZodString;
    nodeType: z.ZodEnum<{
      airapp: "airapp";
      base: "base";
      doc: "doc";
      drive: "drive";
      file: "file";
      folder: "folder";
      skill: "skill";
    }>;
    createdAt: z.ZodString;
    expiresAt: z.ZodString;
    revokedAt: z.ZodNullable<z.ZodString>;
    active: z.ZodBoolean;
    framePolicy: z.ZodObject<
      {
        mode: z.ZodEnum<{
          anywhere: "anywhere";
          origins: "origins";
          "top-level-only": "top-level-only";
        }>;
        allowedOrigins: z.ZodArray<z.ZodString>;
      },
      z.core.$strip
    >;
    url: z.ZodString;
    iframeUrl: z.ZodString;
  },
  z.core.$strip
>;
export type CreatedEmbedLinkVO = z.infer<typeof CreatedEmbedLinkVOSchema>;
export declare const RevokeEmbedLinkVOSchema: z.ZodObject<
  {
    revoked: z.ZodLiteral<true>;
  },
  z.core.$strip
>;
export type RevokeEmbedLinkVO = z.infer<typeof RevokeEmbedLinkVOSchema>;
