import { PGlite } from "@electric-sql/pglite";
import { ORPCError, os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { BatchHandlerPlugin } from "@orpc/server/plugins";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BusabaseErrorLoggingPlugin } from "../src/openapi/error-logging";
import { createBusabaseOpenApiHandler } from "../src/openapi/handler";

const ORIGIN = "https://busabase.example";
const SECRET = "private-value-must-not-be-logged";
const databaseFailure = () => {
  const cause = Object.assign(
    new Error('relation "busabase_app_user_app_settings" does not exist'),
    {
      name: "PostgresError",
      code: "42P01",
      detail: SECRET,
      hint: SECRET,
      query: `select '${SECRET}'`,
      parameters: [SECRET],
      stack: `PostgresError: ${SECRET}\n    at execute (/app/query.ts:12:3)\n    at run (.next/server/chunks/ssr/[root-of-the-server]__a1b2._.js:1:2)\n    at route (/app/.next/server/app/api/rpc/[[...rest]]/route.js:3:4)\n${SECRET}\n    at bad (https://user:${SECRET}@example.com/file.js:1:2)`,
    },
  );
  return Object.assign(
    new Error(`Failed query: select '${SECRET}'\nparams: ${SECRET}`, { cause }),
    {
      name: "DrizzleQueryError",
      stack: `DrizzleQueryError: ${SECRET}\n    at findAppSettings (/app/settings.ts:20:4)\n${SECRET}`,
    },
  );
};
const settings = os
  .route({ method: "GET", path: "/api/v1/app-users/apps/{appId}/settings" })
  .input(z.object({ appId: z.string() }))
  .handler(() => {
    throw databaseFailure();
  });
const router = {
  appUsers: { getSettings: settings },
  forbidden: os.route({ method: "GET", path: "/api/v1/forbidden" }).handler(() => {
    throw new ORPCError("FORBIDDEN", { message: SECRET });
  }),
  ok: os.route({ method: "GET", path: "/api/v1/ok" }).handler(() => ({ ok: true })),
  input: os
    .route({ method: "POST", path: "/api/v1/input" })
    .input(z.object({ required: z.string() }))
    .handler(({ input }) => input),
};

const logRecords = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, any>);

afterEach(() => vi.restoreAllMocks());

describe("oRPC server error logging", () => {
  it("logs sanitized nested causes before OpenAPI encodes the 500 and correlates its response", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = createBusabaseOpenApiHandler(router);
    const result = await handler.handle(
      new Request(`${ORIGIN}/api/v1/app-users/apps/nod_shop/settings?token=${SECRET}`, {
        headers: { authorization: `Bearer ${SECRET}`, cookie: SECRET, "x-request-id": SECRET },
      }),
      { context: {} },
    );
    expect(result.matched).toBe(true);
    expect(result.response?.status).toBe(500);
    expect(await result.response?.json()).toEqual({
      error: "Internal server error",
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [record] = logRecords(spy);
    expect(record).toMatchObject({
      event: "busabase.api_error",
      level: "ERROR",
      status: 500,
      method: "GET",
      pathname: "/api/v1/app-users/apps/nod_shop/settings",
      procedure: "appUsers.getSettings",
      requestId: result.response?.headers.get("x-request-id"),
      causes: [
        { name: "DrizzleQueryError", frames: ["/app/settings.ts:20:4"] },
        {
          name: "PostgresError",
          sqlState: "42P01",
          reason: "undefined_table",
          table: "busabase_app_user_app_settings",
          frames: [
            "/app/query.ts:12:3",
            ".next/server/chunks/ssr/[root-of-the-server]__a1b2._.js:1:2",
            "/app/.next/server/app/api/rpc/[[...rest]]/route.js:3:4",
          ],
        },
      ],
    });
    expect(record?.requestId).toMatch(/^[\da-f-]{36}$/);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Failed query");
  });

  it("records a real PGlite missing-table cause", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = new PGlite();
    try {
      const handler = createBusabaseOpenApiHandler({
        missingSettings: os.route({ method: "GET", path: "/api/v1/settings" }).handler(async () => {
          await db.query("SELECT app_id FROM busabase_app_user_app_settings");
        }),
      });
      const result = await handler.handle(new Request(`${ORIGIN}/api/v1/settings`), {
        context: {},
      });
      expect(result.response?.status).toBe(500);
      expect(logRecords(spy)[0]?.causes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sqlState: "42P01",
            reason: "undefined_table",
            table: "busabase_app_user_app_settings",
          }),
        ]),
      );
      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(spy.mock.calls)).not.toContain("SELECT app_id");
    } finally {
      await db.close();
    }
  });

  it("keeps normal success, expected refusals, malformed JSON and invalid input quiet", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = createBusabaseOpenApiHandler(router);
    for (const [path, status, init] of [
      ["/ok", 200, undefined],
      ["/forbidden", 403, undefined],
      [
        "/input",
        400,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{" },
      ],
      [
        "/input",
        400,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      ],
    ] as const) {
      const result = await handler.handle(new Request(`${ORIGIN}/api/v1${path}`, init), {
        context: {},
      });
      expect(result.response?.status).toBe(status);
      expect(result.response?.headers.get("x-request-id")).toMatch(/^[\da-f-]{36}$/);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("logs each failed RPC batch item with the outer response ID even when the batch returns 200", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = new RPCHandler(router, {
      plugins: [new BatchHandlerPlugin({ successStatus: 200 }), new BusabaseErrorLoggingPlugin()],
    });
    const result = await handler.handle(
      new Request(`${ORIGIN}/api/rpc/__batch__`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-orpc-batch": "buffered",
          authorization: SECRET,
        },
        body: JSON.stringify([
          {
            url: `${ORIGIN}/api/rpc/appUsers/getSettings?secret=${SECRET}`,
            method: "POST",
            body: { json: { appId: "nod_shop" } },
          },
          { url: `${ORIGIN}/api/rpc/ok`, method: "POST", body: { json: null } },
          {
            url: `${ORIGIN}/api/rpc/appUsers/getSettings`,
            method: "POST",
            body: { json: { appId: "nod_shop" } },
          },
        ]),
      }),
      { context: {}, prefix: "/api/rpc" },
    );
    expect(result.response?.status).toBe(200);
    const items = await result.response?.json();
    expect(
      items
        .map((item: { index: number; status?: number }) => [item.index, item.status ?? 200])
        .sort(),
    ).toEqual([
      [0, 500],
      [1, 200],
      [2, 500],
    ]);
    expect(spy).toHaveBeenCalledTimes(2);
    for (const record of logRecords(spy)) {
      expect(record).toMatchObject({
        pathname: "/api/rpc/appUsers/getSettings",
        procedure: "appUsers.getSettings",
        requestId: result.response?.headers.get("x-request-id"),
      });
    }
    expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
  });

  it("preserves snapshot SSE output and its completion frame", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = createBusabaseOpenApiHandler({
      snapshot: os
        .route({ method: "POST", path: "/api/v1/dump/export/snapshot" })
        .handler(async function* () {
          yield { part: "records", count: 1 };
          return { complete: true };
        }),
    });
    const result = await handler.handle(
      new Request(`${ORIGIN}/api/v1/dump/export/snapshot`, { method: "POST" }),
      { context: {} },
    );
    expect(result.response?.status).toBe(200);
    expect(result.response?.headers.get("content-type")).toContain("text/event-stream");
    expect(result.response?.headers.get("x-request-id")).toMatch(/^[\da-f-]{36}$/);
    const text = await result.response?.text();
    expect(text).toContain('event: message\ndata: {"part":"records","count":1}');
    expect(text).toContain('event: done\ndata: {"complete":true}');
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps IDs separate for concurrent requests and bounds cyclic cause chains", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = databaseFailure();
    Object.assign(failure.cause as object, { cause: failure });
    const handler = createBusabaseOpenApiHandler({
      broken: os
        .route({ method: "GET", path: "/api/v1/{id}" })
        .input(z.object({ id: z.string() }))
        .handler(async () => {
          await Promise.resolve();
          throw failure;
        }),
    });
    const results = await Promise.all(
      ["first", "second"].map((id) =>
        handler.handle(new Request(`${ORIGIN}/api/v1/${id}`), { context: {} }),
      ),
    );
    const records = logRecords(spy);
    expect(records).toHaveLength(2);
    expect(new Set(records.map((record) => record.requestId)).size).toBe(2);
    for (const [index, result] of results.entries()) {
      const record = records.find(
        (entry) => entry.pathname === `/api/v1/${index === 0 ? "first" : "second"}`,
      );
      expect(record?.requestId).toBe(result.response?.headers.get("x-request-id"));
      expect(record?.causes).toHaveLength(2);
      expect(record?.causesTruncated).toBe(true);
    }
  });
});
