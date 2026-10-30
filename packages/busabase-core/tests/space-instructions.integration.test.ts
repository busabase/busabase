import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createRouterClient } from "@orpc/server";
import {
  SPACE_INSTRUCTIONS_MAX_BYTES,
  SpaceInstructionsBodySchema,
} from "busabase-contract/domains/space-instructions/types";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  runWithAnonymousContext,
  runWithBusabaseContext,
  runWithEmbedContext,
} from "../src/context";
import {
  getSpaceInstructions,
  type SpaceInstructionsActor,
  updateSpaceInstructions,
} from "../src/domains/space-instructions/logic/space-instructions";
import { spaceInstructionsRouter } from "../src/domains/space-instructions/router";

const manager = (spaceId: string): SpaceInstructionsActor => ({
  spaceId,
  isSpaceManager: true,
  permissionLevel: "manage",
  isVisitor: false,
});

// Test the generated production migration against a real SQL engine, not a
// mocked query builder or a second hand-written CREATE TABLE definition.
const migration = path.resolve(
  __dirname,
  "../../../apps/busabase/src/db/migrations/0037_nice_terrax.sql",
);

describe("space instructions persistence and access", () => {
  let connection: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    connection = await PGlite.create();
    db = drizzle(connection);
    await connection.exec(await readFile(migration, "utf8"));
  });

  afterAll(async () => connection?.close());

  it("round-trips the exact shared background, isolates spaces, and preserves a clear operation", async () => {
    const actor = manager("team-a");
    expect(await getSpaceInstructions(db, actor)).toEqual({
      spaceId: "team-a",
      body: "",
      version: 0,
      updatedAt: null,
    });
    const body = "# 愿景、使命、价值观\n\n设计风格：清楚、安静。\n";
    const saved = await updateSpaceInstructions(db, actor, { body, expectedVersion: 0 });
    expect(saved.body).toBe(body);
    expect(saved.version).toBe(1);
    expect(saved.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await getSpaceInstructions(db, actor)).toEqual(saved);
    expect(await getSpaceInstructions(db, manager("team-b"))).toEqual({
      spaceId: "team-b",
      body: "",
      version: 0,
      updatedAt: null,
    });
    const cleared = await updateSpaceInstructions(db, actor, { body: "", expectedVersion: 1 });
    expect(cleared.body).toBe("");
    expect(cleared.version).toBe(2);
    expect(await getSpaceInstructions(db, actor)).toEqual(cleared);
    await expect(
      updateSpaceInstructions(db, actor, { body: "Stale draft", expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await getSpaceInstructions(db, actor)).toEqual(cleared);
  });

  it("never overwrites an initial insert or edit when two editors save the same version", async () => {
    const actor = manager("concurrent-team");
    const initial = await Promise.allSettled([
      updateSpaceInstructions(db, actor, { body: "First editor", expectedVersion: 0 }),
      updateSpaceInstructions(db, actor, { body: "Second editor", expectedVersion: 0 }),
    ]);
    expect(initial.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(initial.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT" },
    });
    expect((await getSpaceInstructions(db, actor)).version).toBe(1);
    const edits = await Promise.allSettled([
      updateSpaceInstructions(db, actor, { body: "First revision", expectedVersion: 1 }),
      updateSpaceInstructions(db, actor, { body: "Second revision", expectedVersion: 1 }),
    ]);
    expect(edits.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(edits.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT" },
    });
    const saved = await getSpaceInstructions(db, actor);
    expect(saved.version).toBe(2);
    const winner = edits.find((result) => result.status === "fulfilled");
    if (winner?.status !== "fulfilled") throw new Error("No edit was saved");
    expect(saved).toEqual(winner.value);
  });

  it("lets members and read keys read shared background without allowing them to edit it", async () => {
    const actor = manager("permission-team");
    await updateSpaceInstructions(db, actor, { body: "Shared context", expectedVersion: 0 });
    const readers = [
      { ...actor, isSpaceManager: false, permissionLevel: "read" as const },
      { ...actor, credentialPermissionCeiling: "read" as const },
      { ...actor, isSpaceManager: false, permissionLevel: "manage" as const },
    ];
    for (const reader of readers) {
      expect((await getSpaceInstructions(db, reader)).body).toBe("Shared context");
      await expect(
        updateSpaceInstructions(db, reader, { body: "Unauthorized edit", expectedVersion: 1 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    for (const visitor of [
      { ...actor, isVisitor: true },
      { ...actor, permissionLevel: "read" as const, isVisitor: true },
    ]) {
      await expect(getSpaceInstructions(db, visitor)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        updateSpaceInstructions(db, visitor, { body: "Leak", expectedVersion: 1 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await getSpaceInstructions(db, actor)).body).toBe("Shared context");
  });

  it("resolves tenant and permissions from the actual router context, including link visitors", async () => {
    const client = createRouterClient(spaceInstructionsRouter);
    const inTeam = <T>(spaceId: string, fn: () => Promise<T>) =>
      runWithBusabaseContext({ db, spaceId, isSpaceManager: true }, fn);
    const saved = await inTeam("router-team", () =>
      client.update({ body: "Router context, not caller input", expectedVersion: 0 }),
    );
    expect(saved.spaceId).toBe("router-team");
    expect(await inTeam("router-team", () => client.get())).toEqual(saved);
    expect((await inTeam("other-router-team", () => client.get())).body).toBe("");
    await expect(
      runWithBusabaseContext(
        { db, spaceId: "router-team", isSpaceManager: true, credentialPermissionCeiling: "read" },
        () => client.update({ body: "Read-key edit", expectedVersion: 1 }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      runWithAnonymousContext({ db, spaceId: "router-team" }, () => client.get()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      runWithEmbedContext({ db, spaceId: "router-team", actorId: "owner" }, () => client.get()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects oversized multi-byte text at the API boundary without modifying stored content", async () => {
    expect(
      SpaceInstructionsBodySchema.safeParse("a".repeat(SPACE_INSTRUCTIONS_MAX_BYTES)).success,
    ).toBe(true);
    const body = "愿".repeat(Math.floor(SPACE_INSTRUCTIONS_MAX_BYTES / 3) + 1);
    expect(SpaceInstructionsBodySchema.safeParse(body).success).toBe(false);
    const actor = manager("validation-team");
    await expect(
      updateSpaceInstructions(db, actor, { body, expectedVersion: 0 }),
    ).rejects.toThrow();
    expect((await getSpaceInstructions(db, actor)).version).toBe(0);
  });
});
