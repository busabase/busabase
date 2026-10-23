import { os } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { describe, expect, it } from "vitest";
import { createBusabaseOpenApiHandler } from "../src/openapi/handler";

/**
 * A query string has no types: `?mine=true` reaches the server as the STRING
 * `"true"`, `?status[]=merged` as `["merged"]`, `?page=2` as `"2"`. Before the
 * shared handler coerced against the input schema, every GET input field that
 * was not a string or a `z.coerce` number answered 400 to a client following
 * the published spec — e.g. `GET /change-requests?mine=true` → "expected
 * boolean, received string".
 *
 * Each probe below mounts the REAL contract route + input schema behind the
 * REAL shared handler factory, and echoes the parsed input back, so what is
 * asserted is exactly what the logic layer would receive.
 */

const probe = (procedure: any) => {
  const { route, inputSchema } = procedure["~orpc"];
  return os
    .route(route)
    .input(inputSchema)
    .handler(({ input }) => ({ input }));
};

const handler = createBusabaseOpenApiHandler({
  changeRequestsList: probe(busabaseContract.changeRequests.list),
  templatesList: probe(busabaseContract.templates.list),
  listMentions: probe(busabaseContract.comments.listMentions),
});

const get = async (pathAndQuery: string) => {
  const { matched, response } = await handler.handle(
    new Request(`http://localhost/api/v1${pathAndQuery}`),
    { context: {} },
  );
  expect(matched).toBe(true);
  return { status: response?.status, body: (await response?.json()) as any };
};

describe("/api/v1 GET query coercion (shared handler)", () => {
  it("mine=true arrives as boolean true", async () => {
    const { status, body } = await get("/change-requests?status[]=merged&mine=true&limit=2");
    expect(status).toBe(200);
    expect(body.input).toMatchObject({ status: ["merged"], mine: true, limit: 2 });
  });

  it("mine=false arrives as boolean false, not true", async () => {
    const { status, body } = await get("/change-requests?mine=false");
    expect(status).toBe(200);
    expect(body.input.mine).toBe(false);
  });

  it("an unrecognised boolean string is still rejected, not guessed", async () => {
    const { status, body } = await get("/change-requests?mine=yesplease");
    expect(status).toBe(400);
    expect(body.code).toBe("BAD_REQUEST");
  });

  it("status[]= with several values keeps them all", async () => {
    const { status, body } = await get("/change-requests?status[]=merged&status[]=rejected");
    expect(status).toBe(200);
    expect(body.input.status).toEqual(["merged", "rejected"]);
  });

  it("previously valid requests are unchanged", async () => {
    const plain = await get("/change-requests?limit=5&cursor=abc");
    expect(plain.status).toBe(200);
    expect(plain.body.input).toEqual({ limit: 5, cursor: "abc" });

    const bare = await get("/change-requests");
    expect(bare.status).toBe(200);
    expect(bare.body.input).toEqual({ limit: 50 });
  });

  it("other GET routes with boolean / number query fields are coerced too", async () => {
    const templates = await get("/templates?refresh=false");
    expect(templates.status).toBe(200);
    expect(templates.body.input.refresh).toBe(false);

    const mentions = await get("/comments/mentions?page=2&pageSize=10");
    expect(mentions.status).toBe(200);
    expect(mentions.body.input).toMatchObject({ page: 2, pageSize: 10 });
  });
});
