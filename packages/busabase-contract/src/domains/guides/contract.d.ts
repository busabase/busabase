import { z } from "zod";
export declare const guidesContract: {
  list: import("@orpc/contract").ContractProcedureBuilderWithOutput<
    import("@orpc/contract").Schema<unknown, unknown>,
    z.ZodArray<
      z.ZodObject<
        {
          topic: z.ZodString;
          title: z.ZodString;
          kind: z.ZodEnum<{
            reference: "reference";
            walkthrough: "walkthrough";
          }>;
          summary: z.ZodString;
        },
        z.core.$strip
      >
    >,
    Record<never, never>,
    Record<never, never>
  >;
  read: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodObject<
      {
        topic: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        topic: z.ZodString;
        title: z.ZodString;
        kind: z.ZodEnum<{
          reference: "reference";
          walkthrough: "walkthrough";
        }>;
        content: z.ZodString;
        otherTopics: z.ZodArray<z.ZodString>;
      },
      z.core.$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
};
