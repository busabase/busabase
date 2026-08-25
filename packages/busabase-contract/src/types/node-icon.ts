import { z } from "zod";

/**
 * A node's custom avatar — either a single emoji or an uploaded/cropped image.
 * Optional and orthogonal to the node-type default icon (`nodeIconForType`):
 * when a node carries no `icon`, every host falls back to the type icon, same
 * as before this field existed.
 *
 * The `attachment` variant follows the shared avatar-cropping model:
 * `url`/`attachmentId` are the CROPPED display image actually rendered, while
 * `originalUrl`/`originalAttachmentId` + `crop` are kept so the crop dialog can
 * re-open non-destructively against the untouched source image instead of
 * re-cropping an already-cropped image.
 */
export const NodeIconSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("emoji"), value: z.string() }),
  z.object({
    type: z.literal("attachment"),
    url: z.string(),
    attachmentId: z.string(),
    originalUrl: z.string().optional(),
    originalAttachmentId: z.string().optional(),
    crop: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
  }),
]);
export type NodeIcon = z.infer<typeof NodeIconSchema>;
