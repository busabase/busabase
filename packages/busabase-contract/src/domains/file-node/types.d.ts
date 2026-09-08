import { z } from "zod";
export declare const FileNodeMetadataSchema: z.ZodObject<
  {
    assetId: z.ZodString;
  },
  z.core.$strip
>;
export type FileNodeMetadata = z.infer<typeof FileNodeMetadataSchema>;
export declare const FileNodeVOSchema: z.ZodObject<
  {
    node: z.ZodType<
      import("../../contract/schemas").NodeOutput,
      unknown,
      z.core.$ZodTypeInternals<import("../../contract/schemas").NodeOutput, unknown>
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
  },
  z.core.$strip
>;
export type FileNodeVO = z.infer<typeof FileNodeVOSchema>;
