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

/**
 * WHICH visual a node shows — its own emoji, its own image, or its type's
 * default icon — decided once, for every host.
 *
 * Platform-neutral on purpose: web resolves `kind: "type"` to a lucide-react
 * component, React Native to a lucide-react-native one, and neither can import
 * the other's. Before this lived here, web kept the decision inside a module
 * that also imported lucide-react, so mobile could not reuse it and simply
 * never showed custom icons at all — a node given an emoji on web appeared on
 * the phone with the generic type icon.
 */
export type NodeIconSource =
  | { kind: "emoji"; value: string }
  | { kind: "image"; url: string; shape: "app" | "square" }
  | { kind: "type" };

export const resolveNodeIconSource = (node: {
  type: string;
  icon?: NodeIcon | null;
}): NodeIconSource => {
  if (node.icon?.type === "emoji" && node.icon.value) {
    return { kind: "emoji", value: node.icon.value };
  }
  if (node.icon?.type === "attachment" && node.icon.url) {
    return { kind: "image", url: node.icon.url, shape: node.type === "airapp" ? "app" : "square" };
  }
  return { kind: "type" };
};
