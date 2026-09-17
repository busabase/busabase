import "server-only";

import { searchInteractionInputSchema } from "busabase-contract/contract/schemas";
import { z } from "zod";
import {
  type BusabaseSearchInteractionMetric,
  type BusabaseSearchRequestMetric,
  emitContextPerformanceMetric,
} from "../context";

const searchRequestMetricSchema = z
  .object({
    name: z.literal("search.request.completed"),
    durationMs: z.number().int().nonnegative(),
    mode: z.enum(["quick", "full"]),
    surface: z.enum(["quick", "advanced", "api"]),
    resultCount: z.number().int().nonnegative(),
    emptyPage: z.boolean(),
    hasMore: z.boolean(),
    offset: z.number().int().nonnegative(),
    sourceCount: z.number().int().min(0).max(4),
  })
  .strict();

const writeStructuredSearchLog = (
  metric: BusabaseSearchRequestMetric | BusabaseSearchInteractionMetric,
) => {
  try {
    // Local/self-hosted Busabase already collects stdout. Keep the payload a
    // fixed schema with no query, ids, titles, hrefs, or tenant identifiers.
    if (process.env.NODE_ENV !== "test") {
      console.info("[busabase.search]", JSON.stringify(metric));
    }
    emitContextPerformanceMetric(() => metric);
  } catch {
    // Search metrics are diagnostic only and must never break product behavior.
  }
};

export const recordSearchRequest = (input: BusabaseSearchRequestMetric): void => {
  const parsed = searchRequestMetricSchema.safeParse(input);
  if (parsed.success) writeStructuredSearchLog(parsed.data);
};

export const recordSearchInteraction = (
  input: z.input<typeof searchInteractionInputSchema>,
): { accepted: true } => {
  const event = searchInteractionInputSchema.parse(input);
  writeStructuredSearchLog({
    name: "search.interaction",
    durationMs: event.event === "results_shown" ? event.durationMs : 0,
    ...event,
  });
  return { accepted: true };
};

export const serializeSearchMetricForLog = (
  metric: BusabaseSearchRequestMetric | BusabaseSearchInteractionMetric,
): string => JSON.stringify(metric);
