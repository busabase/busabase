import { createRouterClient } from "@orpc/server";
import { searchInteractionInputSchema } from "busabase-contract/contract/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BusabasePerformanceMetric, runWithBusabaseContext } from "../context";
import { busabaseRouter } from "../router";
import { recordSearchRequest, serializeSearchMetricForLog } from "./search-metrics";

const SESSION_ID = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("privacy-safe search metrics", () => {
  it("strictly rejects raw query text instead of silently stripping it", () => {
    expect(() =>
      searchInteractionInputSchema.parse({
        event: "result_click",
        sessionId: SESSION_ID,
        surface: "quick",
        position: 1,
        resultKind: "record",
        query: "private acquisition plan",
      }),
    ).toThrow();
  });

  it("records only fixed aggregate fields through the router", async () => {
    const metrics: BusabasePerformanceMetric[] = [];
    const client = createRouterClient(busabaseRouter);

    const response = await runWithBusabaseContext(
      {
        onPerformanceMetric: (metric) => {
          metrics.push(metric);
        },
      },
      () =>
        client.searchMetrics.report({
          event: "results_shown",
          sessionId: SESSION_ID,
          surface: "advanced",
          resultCount: 0,
          durationMs: 432,
          hasMore: false,
        }),
    );

    expect(response).toEqual({ accepted: true });
    expect(metrics).toHaveLength(1);
    const metric = metrics[0];
    if (metric?.name !== "search.interaction") throw new Error("expected search interaction");
    const serialized = serializeSearchMetricForLog(metric);
    expect(serialized).not.toContain("query");
    expect(serialized).not.toContain("private acquisition plan");
    expect(JSON.parse(serialized)).toEqual({
      name: "search.interaction",
      durationMs: 432,
      event: "results_shown",
      sessionId: SESSION_ID,
      surface: "advanced",
      resultCount: 0,
      hasMore: false,
    });
  });

  it("accepts zero selected sources without letting diagnostics break search", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("log sink unavailable");
    });

    expect(() =>
      recordSearchRequest({
        name: "search.request.completed",
        durationMs: 1,
        mode: "full",
        surface: "api",
        resultCount: 0,
        emptyPage: true,
        hasMore: false,
        offset: 0,
        sourceCount: 0,
      }),
    ).not.toThrow();
  });
});
