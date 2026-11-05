import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { createRouterClient } from "@orpc/server";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  runWithAnonymousContext,
  runWithBusabaseContext,
  runWithEmbedContext,
} from "../src/context";
import { busabaseNodes } from "../src/db/schema";
import {
  getSpaceWelcome,
  type SpaceWelcomeActor,
  updateSpaceWelcome,
} from "../src/domains/space-welcome/logic/space-welcome";
import { spaceWelcomeRouter } from "../src/domains/space-welcome/router";
import { busabaseDemoRouter } from "../src/router-demo";

const manager = (spaceId: string): SpaceWelcomeActor => ({
  spaceId,
  isSpaceManager: true,
  permissionLevel: "manage",
  isVisitor: false,
});

// The generated production migrations, applied in journal order, so the test
// runs against the real `busabase_nodes` table the validation reads and the
// real `busabase_space_welcome` table drizzle-kit produced — not a second,
// hand-written CREATE TABLE that could drift from them.
const MIGRATIONS = path.resolve(__dirname, "../../../apps/busabase/src/db/migrations");

const applyMigrations = async (connection: PGlite) => {
  const journal = JSON.parse(await readFile(path.join(MIGRATIONS, "meta/_journal.json"), "utf8"));
  for (const entry of journal.entries as Array<{ tag: string }>) {
    await connection.exec(await readFile(path.join(MIGRATIONS, `${entry.tag}.sql`), "utf8"));
  }
};

describe("space welcome persistence, validation and access", () => {
  let connection: PGlite;
  let db: ReturnType<typeof drizzle>;

  const node = (
    spaceId: string,
    id: string,
    type: string,
    extra: { archivedAt?: Date; deletedAt?: Date } = {},
  ) =>
    db.insert(busabaseNodes).values({
      id,
      spaceId,
      type: type as never,
      slug: id,
      name: `Node ${id}`,
      ...extra,
    });

  beforeAll(async () => {
    // pg_trgm backs the trigram indexes one of the earlier migrations creates.
    connection = await PGlite.create({ extensions: { pg_trgm } });
    db = drizzle(connection);
    await applyMigrations(connection);
    for (const spaceId of ["team-a", "team-b", "concurrent-team", "permission-team"]) {
      await node(spaceId, `${spaceId}-guide`, "doc");
      await node(spaceId, `${spaceId}-page`, "html");
    }
    await node("team-a", "team-a-base", "base");
    await node("team-a", "team-a-folder", "folder");
    await node("team-a", "team-a-archived", "doc", { archivedAt: new Date() });
    await node("team-a", "team-a-trashed", "html", { deletedAt: new Date() });
    await node("router-team", "router-team-guide", "doc");
  });

  afterAll(async () => connection?.close());

  it("starts unset, points at a Doc then an HTML node, clears, and isolates spaces", async () => {
    const actor = manager("team-a");
    expect(await getSpaceWelcome(db, actor)).toEqual({
      spaceId: "team-a",
      nodeId: null,
      version: 0,
      updatedAt: null,
    });
    const doc = await updateSpaceWelcome(db, actor, {
      nodeId: "team-a-guide",
      expectedVersion: 0,
    });
    expect(doc).toMatchObject({ spaceId: "team-a", nodeId: "team-a-guide", version: 1 });
    expect(doc.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await getSpaceWelcome(db, actor)).toEqual(doc);

    const html = await updateSpaceWelcome(db, actor, { nodeId: "team-a-page", expectedVersion: 1 });
    expect(html).toMatchObject({ nodeId: "team-a-page", version: 2 });

    // Another space never sees this one's choice.
    expect(await getSpaceWelcome(db, manager("team-b"))).toMatchObject({
      nodeId: null,
      version: 0,
    });

    const cleared = await updateSpaceWelcome(db, actor, { nodeId: null, expectedVersion: 2 });
    expect(cleared).toMatchObject({ nodeId: null, version: 3 });
    expect(await getSpaceWelcome(db, actor)).toEqual(cleared);

    await expect(
      updateSpaceWelcome(db, actor, { nodeId: "team-a-guide", expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await getSpaceWelcome(db, actor)).toEqual(cleared);
  });

  it("only accepts a live Doc or HTML node of this space, refusing without changing the welcome", async () => {
    const actor = manager("team-a");
    const before = await getSpaceWelcome(db, actor);
    const refusals: Array<[string, RegExp]> = [
      ["does-not-exist", /No node with id/],
      // Another space's node is indistinguishable from a missing one.
      ["team-b-guide", /No node with id/],
      ["team-a-trashed", /No node with id/],
      ["team-a-archived", /archived/],
      ["team-a-base", /must be one of: doc, html/],
      ["team-a-folder", /must be one of: doc, html/],
    ];
    for (const [nodeId, message] of refusals) {
      // BAD_REQUEST, never NOT_FOUND: the CLI reads a 404 here as "server too old".
      await expect(
        updateSpaceWelcome(db, actor, { nodeId, expectedVersion: before.version }),
        nodeId,
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(message) });
    }
    expect(await getSpaceWelcome(db, actor)).toEqual(before);
  });

  it("never overwrites an initial choice or a change when two managers save the same version", async () => {
    const actor = manager("concurrent-team");
    const initial = await Promise.allSettled([
      updateSpaceWelcome(db, actor, { nodeId: "concurrent-team-guide", expectedVersion: 0 }),
      updateSpaceWelcome(db, actor, { nodeId: "concurrent-team-page", expectedVersion: 0 }),
    ]);
    expect(initial.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(initial.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT" },
    });
    const edits = await Promise.allSettled([
      updateSpaceWelcome(db, actor, { nodeId: null, expectedVersion: 1 }),
      updateSpaceWelcome(db, actor, { nodeId: "concurrent-team-guide", expectedVersion: 1 }),
    ]);
    expect(edits.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const winner = edits.find((result) => result.status === "fulfilled");
    if (winner?.status !== "fulfilled") throw new Error("No edit was saved");
    expect(await getSpaceWelcome(db, actor)).toEqual(winner.value);
    expect(winner.value.version).toBe(2);
  });

  it("lets members and read keys read the choice, but only managers change it, and visitors neither", async () => {
    const actor = manager("permission-team");
    await updateSpaceWelcome(db, actor, { nodeId: "permission-team-guide", expectedVersion: 0 });
    const readers = [
      { ...actor, isSpaceManager: false, permissionLevel: "read" as const },
      { ...actor, credentialPermissionCeiling: "read" as const },
      { ...actor, isSpaceManager: false, permissionLevel: "manage" as const },
    ];
    for (const reader of readers) {
      expect((await getSpaceWelcome(db, reader)).nodeId).toBe("permission-team-guide");
      await expect(
        updateSpaceWelcome(db, reader, { nodeId: null, expectedVersion: 1 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    for (const visitor of [
      { ...actor, isVisitor: true },
      { ...actor, permissionLevel: "read" as const, isVisitor: true },
    ]) {
      await expect(getSpaceWelcome(db, visitor)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        updateSpaceWelcome(db, visitor, { nodeId: null, expectedVersion: 1 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // A refused writer is refused before the node is even looked up.
    await expect(
      updateSpaceWelcome(
        db,
        { ...actor, isSpaceManager: false },
        { nodeId: "does-not-exist", expectedVersion: 1 },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getSpaceWelcome(db, actor)).nodeId).toBe("permission-team-guide");
  });

  it("resolves tenant and permissions from the router context, including link visitors", async () => {
    const client = createRouterClient(spaceWelcomeRouter);
    const inTeam = <T>(spaceId: string, fn: () => Promise<T>) =>
      runWithBusabaseContext({ db, spaceId, isSpaceManager: true }, fn);
    const saved = await inTeam("router-team", () =>
      client.update({ nodeId: "router-team-guide", expectedVersion: 0 }),
    );
    expect(saved).toMatchObject({ spaceId: "router-team", nodeId: "router-team-guide" });
    expect(await inTeam("router-team", () => client.get())).toEqual(saved);
    // The space comes from the context, so another tenant cannot point at it.
    expect((await inTeam("other-router-team", () => client.get())).nodeId).toBeNull();
    await expect(
      inTeam("other-router-team", () =>
        client.update({ nodeId: "router-team-guide", expectedVersion: 0 }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      runWithBusabaseContext(
        { db, spaceId: "router-team", isSpaceManager: true, credentialPermissionCeiling: "read" },
        () => client.update({ nodeId: null, expectedVersion: 1 }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      runWithBusabaseContext({ db, spaceId: "router-team", isSpaceManager: false }, () =>
        client.update({ nodeId: null, expectedVersion: 1 }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (
        await runWithBusabaseContext({ db, spaceId: "router-team", isSpaceManager: false }, () =>
          client.get(),
        )
      ).nodeId,
    ).toBe("router-team-guide");
    await expect(
      runWithAnonymousContext({ db, spaceId: "router-team" }, () => client.get()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      runWithEmbedContext({ db, spaceId: "router-team", actorId: "owner" }, () => client.get()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the stateless demo reports no welcome page and refuses to pretend it saved one", async () => {
    const demo = createRouterClient(busabaseDemoRouter);
    expect(await demo.spaceWelcome.get()).toMatchObject({ nodeId: null, version: 0 });
    await expect(
      demo.spaceWelcome.update({ nodeId: "anything", expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
