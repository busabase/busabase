/**
 * The old-server fallback, proved at the TRANSPORT boundary.
 *
 * `isMissingRouteError`'s own unit tests only prove it against strings this
 * repo wrote down. What actually decides whether a fallback fires is the error
 * oRPC's RPCLink produces when a real server does not serve a procedure — and
 * that turned out not to be any of the wordings a first draft guessed at. This
 * test stands up an HTTP server that answers an unmatched request exactly the
 * way the production server's `/api/rpc` route does
 * (`Response.json({ error: "Not found" }, { status: 404 })`), calls it through
 * the same RPCLink + compatibility fetch the app builds, and pins both
 * directions: a missing procedure is recognised, and a refusal the server MEANT
 * is not — because replaying a declined install on the legacy route is the one
 * way this fallback could create real resources twice.
 *
 * Mobile ships through the App Store independently of the server, so this is
 * the routine case, not an edge one.
 */
import { createServer } from "node:http";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { ORPCError, os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { expect, it } from "vitest";
import { createMobileCompatibilityFetch, isMissingRouteError } from "~/api/mobile-api-compat";

// An OLDER server: it serves the procedures it has, and answers anything else
// exactly the way the production server's /api/rpc route does —
// `Response.json({ error: "Not found" }, { status: 404 })`.
const oldServerRouter = os.router({
  install: {
    fromGithub: os.handler(() => ({ ok: true })),
    refused: os.handler(() => {
      throw new ORPCError("FORBIDDEN", { message: "Only a space admin can install a package" });
    }),
  },
  changeRequests: { list: os.handler(() => ({ ok: true })) },
});

it("recognises a procedure an older server does not serve", async () => {
  const handler = new RPCHandler(oldServerRouter);
  const server = createServer(async (req, res) => {
    const { matched } = await handler.handle(req, res, { prefix: "/api/rpc" });
    if (!matched) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  // The same transport mobile builds: RPCLink, batching off, through the
  // compatibility fetch that rewrites JSON responses.
  const client = createORPCClient(
    new RPCLink({
      url: `http://127.0.0.1:${port}/api/rpc`,
      fetch: createMobileCompatibilityFetch(globalThis.fetch),
    }),
    // The client is deliberately untyped here: the point of the test is to call
    // procedures this server does NOT have, which no contract-derived client
    // type can express.
  ) as Record<string, Record<string, (input: unknown) => Promise<unknown>>>;

  for (const [, call] of [
    ["install.fromGithubStream", () => client.install.fromGithubStream({ repoUrl: "x" })],
    ["changeRequests.inboxSnapshot", () => client.changeRequests.inboxSnapshot({})],
  ] as const) {
    let caught: unknown;
    try {
      await call();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(isMissingRouteError(caught)).toBe(true);
  }

  // A refusal the server MEANT must not look like a missing route — otherwise
  // the fallback would replay an install the server just declined.
  let refusal: unknown;
  try {
    await client.install.refused({});
  } catch (error) {
    refusal = error;
  }
  expect(isMissingRouteError(refusal)).toBe(false);

  // Procedures the old server DOES have must still work and must not be
  // mistaken for missing routes.
  await expect(client.install.fromGithub({ repoUrl: "x" })).resolves.toEqual({ ok: true });
  await expect(client.changeRequests.list({})).resolves.toEqual({ ok: true });

  await new Promise<void>((resolve) => server.close(() => resolve()));
}, 20000);
