import { z } from "zod";

/**
 * Standard response envelope — every JSON response is wrapped in this shape.
 * Mirrors apps/sandock's `createResponseVOSchema` / `createSuccessResponse` so the
 * external API contract (and the emitted OpenAPI response bodies) stay identical.
 */
export const responseVO = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.boolean(),
    code: z.number(),
    message: z.string(),
    data,
  });

export interface ResponseVO<T> {
  success: boolean;
  code: number;
  message: string;
  data: T;
}

export const createSuccessResponse = <T>(data: T, message = "SUCCESS"): ResponseVO<T> => ({
  success: true,
  code: 200,
  message,
  data,
});

export const createErrorResponse = (message: string, code: number): ResponseVO<object> => ({
  success: false,
  code,
  message,
  data: {},
});
