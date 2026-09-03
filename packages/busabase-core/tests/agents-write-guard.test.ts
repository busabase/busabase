import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { agentsRouter } from "../src/domains/agents/router";

/**
 * The dashboard-path floor for `agents.*`.
 *
 * Before Ask Agent, `/api/rpc` applied no workspace floor to this family at all
 * — any member could drive an agent. These assertions are that floor.
 *
 * It is `write`, not the `manage` that `access-control/api-key-level.ts`
 * assigns the family: that table governs credentials and is already enforced
 * for them elsewhere (`openapi/router.ts`, `embed-links/runtime-router.ts`),
 * while this guard governs people in the dashboard. The router's own comment
 * carries the full reasoning; what matters here is that both floors exist and
 * neither is a substitute for the other.
 *
 * No database is touched: the guard runs as middleware, so a refused call never
 * reaches a handler.
 */
const client = createRouterClient(agentsRouter);

/** Every procedure in the family, so a new one cannot quietly skip the gate. */
const CALLS: [string, () => Promise<unknown>][] = [
  ["catalog", () => client.catalog()],
  ["connections.list", () => client.connections.list({ scope: "mine" })],
  ["disconnect", () => client.disconnect({ slug: "claude-acp" })],
  ["sessions.list", () => client.sessions.list()],
  ["sessions.create", () => client.sessions.create({ slug: "claude-acp" })],
  ["sessions.prompt", () => client.sessions.prompt({ sessionId: "s1", text: "hi" })],
  ["sessions.cancel", () => client.sessions.cancel({ sessionId: "s1" })],
  ["sessions.close", () => client.sessions.close({ sessionId: "s1" })],
  [
    "sessions.respondToPermission",
    () => client.sessions.respondToPermission({ sessionId: "s1", requestId: "r", optionId: "o" }),
  ],
  [
    "sessions.subscribe",
    async () => {
      const stream = await client.sessions.subscribe({ sessionId: "s1", afterSeq: -1 });
      for await (const _event of stream) break;
    },
  ],
];

/**
 * "Got past the gate", without needing a database.
 *
 * `listCatalog` reads Buda connections out of the vault, so in a bare test
 * process it fails on a missing table — which is itself proof the middleware
 * called `next()`. What must never appear is the permission error.
 */
const reachedTheHandler = async (call: () => Promise<unknown>) => {
  const outcome = await call().then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  expect(outcome ?? "").not.toMatch(/Requires .* workspace access/i);
};

describe("agents.* requires workspace write", () => {
  it.each(CALLS)("refuses %s for a read-only member", async (_name, call) => {
    await runWithBusabaseContext({ permissionLevel: "read" }, async () => {
      await expect(call()).rejects.toThrow(/Requires write workspace access/i);
    });
  });

  // The decision this floor encodes: an ordinary Cloud member (baseline `write`)
  // keeps Ask Agent. On Cloud the agent runs on that member's own machine,
  // through their own tunnel, and its writes are still capped to a proposal.
  //
  // One representative call rather than the whole table: past the gate, each
  // handler really runs, and the ones that touch the database would each spin
  // up a PGLite instance to prove a fact the middleware already decided for the
  // whole router. The exhaustive sweep belongs on the refusal path above, where
  // it catches a new procedure that skipped the gate.
  it("lets a member whose baseline is write through", async () => {
    await runWithBusabaseContext({ permissionLevel: "write" }, () =>
      reachedTheHandler(() => client.catalog()),
    );
  });

  // A scoped credential can never exceed its ceiling, even when the space role
  // behind it would allow more — the ceiling is the whole point of issuing one.
  it("refuses a manage-level actor holding a read-capped credential", async () => {
    await runWithBusabaseContext(
      { permissionLevel: "manage", credentialPermissionCeiling: "read" },
      async () => {
        await expect(client.catalog()).rejects.toThrow(/Requires write workspace access/i);
      },
    );
  });

  it("lets a manager through to the handler", async () => {
    await runWithBusabaseContext({ permissionLevel: "manage" }, () =>
      reachedTheHandler(() => client.catalog()),
    );
  });

  // The open-source single-user host injects no permission level at all, and
  // `getContextPermissionLevel` resolves that absence to `manage`. If this ever
  // fails, the guard has locked every self-hosted user out of their own agents.
  it("lets the single-user open-source host through with no context at all", async () => {
    await reachedTheHandler(() => client.catalog());
  });
});
