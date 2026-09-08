import { z } from "zod";
export declare const folderSchema: z.ZodObject<
  {
    node: z.ZodType<
      import("../../contract/schemas").NodeOutput,
      unknown,
      z.core.$ZodTypeInternals<import("../../contract/schemas").NodeOutput, unknown>
    >;
    children: z.ZodArray<
      z.ZodType<
        import("../../contract/schemas").NodeOutput,
        unknown,
        z.core.$ZodTypeInternals<import("../../contract/schemas").NodeOutput, unknown>
      >
    >;
  },
  z.core.$strip
>;
