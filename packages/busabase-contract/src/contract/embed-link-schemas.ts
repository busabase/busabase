import { z } from "zod";

/**
 * Embed Links CRUD (create/list/revoke) DTO + VO schemas — the single source of truth for
 * both the real absolute-path OpenAPI surface (`apps/busabase-cloud/src/domains/embed-links/contract.ts`,
 * `/api/v1/embed-links`) and the relative-path twin registered in `cloudContract` below (the
 * CLI/SDK client's contract, `/embed-links` + the shared `/api/v1` prefix). Two independent route
 * declarations, one shared schema set — same pattern as `system`/`users`/`agentTasks` in `cloud.ts`.
 *
 * Runtime/internal embed schemas that are NOT part of this CLI/SDK CRUD surface (node-detail
 * rendering for the embed viewer, AirApp embed runtime files, etc.) stay local to
 * `apps/busabase-cloud/src/domains/embed-links/types/embed-links.ts` — only the shapes `create` /
 * `list` / `revoke` actually send or return live here.
 */

export const EMBED_LINK_DEFAULT_MINUTES = 15;
export const EMBED_LINK_MAX_MINUTES = 24 * 60;

export const EmbedNodeTypeSchema = z.enum([
  "base",
  "doc",
  "file",
  "drive",
  "skill",
  "folder",
  "airapp",
]);
export type EmbedNodeType = z.infer<typeof EmbedNodeTypeSchema>;

export const EmbedFrameModeSchema = z.enum(["anywhere", "origins", "top-level-only"]);
export type EmbedFrameMode = z.infer<typeof EmbedFrameModeSchema>;

const EmbedAllowedOriginSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Allowed origins must be valid URLs" });
      return;
    }

    const isLocalHttp =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
    if (url.protocol !== "https:" && !isLocalHttp) {
      ctx.addIssue({ code: "custom", message: "Allowed origins must use HTTPS" });
    }
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.hostname.includes("*")
    ) {
      ctx.addIssue({ code: "custom", message: "Allowed origins must be exact origins" });
    }
  })
  .transform((value) => new URL(value).origin);

export const EmbedFramePolicyInputSchema = z
  .discriminatedUnion("mode", [
    z.object({
      mode: z.literal("anywhere"),
      allowedOrigins: z.array(EmbedAllowedOriginSchema).max(0).optional(),
    }),
    z.object({
      mode: z.literal("origins"),
      allowedOrigins: z.array(EmbedAllowedOriginSchema).min(1).max(20),
    }),
    z.object({
      mode: z.literal("top-level-only"),
      allowedOrigins: z.array(EmbedAllowedOriginSchema).max(0).optional(),
    }),
  ])
  .transform((policy) => ({
    mode: policy.mode,
    allowedOrigins: [...new Set(policy.allowedOrigins ?? [])],
  }));

export const EmbedFramePolicyVOSchema = z
  .object({
    mode: EmbedFrameModeSchema,
    allowedOrigins: z.array(z.string().url()),
  })
  .superRefine((policy, ctx) => {
    const validCount =
      policy.mode === "origins"
        ? policy.allowedOrigins.length > 0
        : policy.allowedOrigins.length === 0;
    if (!validCount) ctx.addIssue({ code: "custom", message: "Stored frame policy is invalid" });
  });
export type EmbedFramePolicyVO = z.infer<typeof EmbedFramePolicyVOSchema>;

export const CreateEmbedLinkInputSchema = z.object({
  nodeId: z.string().min(1),
  expiresInMinutes: z
    .number()
    .int()
    .min(1)
    .max(EMBED_LINK_MAX_MINUTES)
    .optional()
    .default(EMBED_LINK_DEFAULT_MINUTES),
  framePolicy: EmbedFramePolicyInputSchema.optional().default({
    mode: "anywhere",
    allowedOrigins: [],
  }),
});
export type CreateEmbedLinkDTO = z.infer<typeof CreateEmbedLinkInputSchema>;

export const ListEmbedLinksInputSchema = z
  .object({ nodeId: z.string().min(1).optional() })
  .optional()
  .default({});
export type ListEmbedLinksDTO = z.infer<typeof ListEmbedLinksInputSchema>;

export const RevokeEmbedLinkInputSchema = z.object({ id: z.string().min(1) });
export type RevokeEmbedLinkDTO = z.infer<typeof RevokeEmbedLinkInputSchema>;

export const EmbedLinkVOSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  nodeName: z.string(),
  nodeType: EmbedNodeTypeSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  active: z.boolean(),
  framePolicy: EmbedFramePolicyVOSchema,
});
export type EmbedLinkVO = z.infer<typeof EmbedLinkVOSchema>;

export const CreatedEmbedLinkVOSchema = EmbedLinkVOSchema.extend({
  url: z.string().url(),
  iframeUrl: z.string().url(),
});
export type CreatedEmbedLinkVO = z.infer<typeof CreatedEmbedLinkVOSchema>;

export const RevokeEmbedLinkVOSchema = z.object({ revoked: z.literal(true) });
export type RevokeEmbedLinkVO = z.infer<typeof RevokeEmbedLinkVOSchema>;
