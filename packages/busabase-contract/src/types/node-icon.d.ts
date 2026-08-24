import { z } from "zod";
/**
 * A node's custom avatar — either a single emoji or an uploaded/cropped image.
 * Optional and orthogonal to the node-type default icon (`nodeIconForType`):
 * when a node carries no `icon`, every host falls back to the type icon, same
 * as before this field existed.
 *
 * The `attachment` variant mirrors buda's `NodeLogo` shape (see
 * `apps/buda/src/domains/agent-controller/components/use-logo-crop-upload.tsx`):
 * `url`/`attachmentId` are the CROPPED display image actually rendered, while
 * `originalUrl`/`originalAttachmentId` + `crop` are kept so the crop dialog can
 * re-open non-destructively against the untouched source image instead of
 * re-cropping an already-cropped image.
 */
export declare const NodeIconSchema: z.ZodDiscriminatedUnion<
  [
    z.ZodObject<
      {
        type: z.ZodLiteral<"emoji">;
        value: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        type: z.ZodLiteral<"attachment">;
        url: z.ZodString;
        attachmentId: z.ZodString;
        originalUrl: z.ZodOptional<z.ZodString>;
        originalAttachmentId: z.ZodOptional<z.ZodString>;
        crop: z.ZodOptional<
          z.ZodObject<
            {
              x: z.ZodNumber;
              y: z.ZodNumber;
              zoom: z.ZodNumber;
            },
            z.core.$strip
          >
        >;
      },
      z.core.$strip
    >,
  ],
  "type"
>;
export type NodeIcon = z.infer<typeof NodeIconSchema>;
