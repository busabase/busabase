import type { ContentBlock, PromptRequest } from "@agentclientprotocol/sdk";
import { z } from "zod";

const metadataSchema = z.record(z.string(), z.unknown()).nullish();
const annotationsSchema = z.object({
  audience: z.array(z.enum(["user", "assistant"])).nullish(),
  lastModified: z.string().nullish(),
  priority: z.number().nullish(),
  _meta: metadataSchema,
});
const contentMetadata = { annotations: annotationsSchema.nullish(), _meta: metadataSchema };
const resourceMetadata = { uri: z.string(), mimeType: z.string().nullish(), _meta: metadataSchema };

// The SDK's runtime schemas are private. Validate raw fixture traffic here,
// while its public types remain the source of truth for all typed consumers.
export const AcpContentBlockSchema: z.ZodType<ContentBlock> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string(), ...contentMetadata }),
  z.object({
    type: z.literal("image"),
    data: z.string(),
    mimeType: z.string(),
    uri: z.string().nullish(),
    ...contentMetadata,
  }),
  z.object({
    type: z.literal("audio"),
    data: z.string(),
    mimeType: z.string(),
    ...contentMetadata,
  }),
  z.object({
    type: z.literal("resource_link"),
    uri: z.string(),
    name: z.string(),
    mimeType: z.string().nullish(),
    title: z.string().nullish(),
    description: z.string().nullish(),
    size: z.number().nullish(),
    ...contentMetadata,
  }),
  z.object({
    type: z.literal("resource"),
    resource: z.union([
      z.object({ text: z.string(), ...resourceMetadata }),
      z.object({ blob: z.string(), ...resourceMetadata }),
    ]),
    ...contentMetadata,
  }),
]);

export const AcpPromptRequestSchema: z.ZodType<PromptRequest> = z.object({
  sessionId: z.string(),
  prompt: z.array(AcpContentBlockSchema).min(1),
  _meta: metadataSchema,
});

export const AcpFixtureStateSchema = z.object({
  sessions: z.number().int().nonnegative(),
  prompts: z.array(AcpPromptRequestSchema),
  configurations: z.array(
    z.object({ id: z.string(), model: z.string(), thinkingLevel: z.string().nullable() }),
  ),
});
export type AcpFixtureState = z.infer<typeof AcpFixtureStateSchema>;
