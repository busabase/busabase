import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseEmbedLinks, busabaseNodes } from "../src/db/schema";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const TARGET_NODE_ID = "nod_embed_audit";
const FUTURE = new Date("2099-01-01T00:00:00.000Z");
const PAST = new Date("2020-01-01T00:00:00.000Z");

describe("embedLinks.listPaged (real PGLite)", () => {
  let dataDir = "";
  let originalCwd = "";
  let client: Client;

  const asManager = <T>(fn: () => Promise<T>) =>
    runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "usr_embed_audit_admin",
        isSpaceManager: true,
      },
      fn,
    );

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-embed-audit-db-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    client = createRouterClient(busabaseRouter);

    const db = await getDb();
    await db.insert(busabaseNodes).values({
      id: TARGET_NODE_ID,
      spaceId: LOCAL_SPACE_ID,
      type: "doc",
      slug: "embed-audit-target",
      name: "Embed audit target",
      explicitVisibility: "workspace",
      effectiveVisibility: "workspace",
    });

    const link = (
      id: string,
      createdAt: string,
      options: {
        spaceId?: string;
        typeId?: string;
        expiresAt?: Date;
        revokedAt?: Date | null;
      } = {},
    ) => ({
      id,
      spaceId: options.spaceId ?? LOCAL_SPACE_ID,
      type: "node" as const,
      typeId: options.typeId ?? TARGET_NODE_ID,
      secretHash: id.padEnd(64, "0"),
      createdBy: "usr_embed_audit_admin",
      createdByApiKeyId: "local",
      frameMode: "anywhere" as const,
      allowedOrigins: [],
      expiresAt: options.expiresAt ?? FUTURE,
      revokedAt: options.revokedAt ?? null,
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
    });

    await db.insert(busabaseEmbedLinks).values([
      link("emb_active_z", "2026-09-10T12:00:00.000Z"),
      link("emb_active_y", "2026-09-10T12:00:00.000Z"),
      link("emb_orphan", "2026-09-09T12:00:00.000Z", { typeId: "nod_missing" }),
      link("emb_active_b", "2026-09-08T12:00:00.000Z"),
      link("emb_active_a", "2026-09-07T12:00:00.000Z"),
      link("emb_expired", "2026-09-06T12:00:00.000Z", { expiresAt: PAST }),
      link("emb_revoked", "2026-09-05T12:00:00.000Z", {
        expiresAt: PAST,
        revokedAt: new Date("2026-09-05T13:00:00.000Z"),
      }),
      link("emb_other_space", "2026-09-11T12:00:00.000Z", { spaceId: "spc_other" }),
    ]);
    await db.insert(busabaseEmbedLinks).values(
      Array.from({ length: 402 }, (_, index) =>
        link(`emb_orphan_bulk_${index.toString().padStart(3, "0")}`, "2019-01-01T00:00:00.000Z", {
          typeId: "nod_missing_bulk",
          expiresAt: PAST,
        }),
      ),
    );
  }, 120_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("paginates by createdAt and id without repeating or skipping visible links", async () => {
    const first = await asManager(() =>
      client.embedLinks.listPaged({ status: "active", limit: 2 }),
    );
    expect(first.items.map((item) => item.id)).toEqual(["emb_active_z", "emb_active_y"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await asManager(() =>
      client.embedLinks.listPaged({
        status: "active",
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      }),
    );
    expect(second.items.map((item) => item.id)).toEqual(["emb_active_b", "emb_active_a"]);
    expect(second.nextCursor).toBeNull();
  });

  it("keeps active, expired, and revoked filters mutually exclusive", async () => {
    const [active, expired, revoked, all] = await asManager(() =>
      Promise.all([
        client.embedLinks.listPaged({ status: "active", limit: 100 }),
        client.embedLinks.listPaged({ status: "expired", limit: 100 }),
        client.embedLinks.listPaged({ status: "revoked", limit: 100 }),
        client.embedLinks.listPaged({ status: "all", limit: 100 }),
      ]),
    );

    expect(active.items).toHaveLength(4);
    expect(expired.items.map((item) => item.id)).toEqual(["emb_expired"]);
    expect(revoked.items.map((item) => item.id)).toEqual(["emb_revoked"]);
    expect(revoked.items[0]).toMatchObject({ active: false, revokedAt: expect.any(String) });
    expect(all.items.map((item) => item.id)).toEqual([
      "emb_active_z",
      "emb_active_y",
      "emb_active_b",
      "emb_active_a",
      "emb_expired",
      "emb_revoked",
    ]);
  });

  it("retains target-level manage filtering behind the workspace audit", async () => {
    const page = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "usr_embed_audit_viewer",
        isSpaceManager: false,
        restrictedVisibility: false,
      },
      () => client.embedLinks.listPaged({ status: "active", limit: 100 }),
    );
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  it("bounds ACL work and advances past a window containing only hidden targets", async () => {
    const first = await asManager(() =>
      client.embedLinks.listPaged({ status: "expired", limit: 100 }),
    );
    expect(first.items.map((item) => item.id)).toEqual(["emb_expired"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await asManager(() =>
      client.embedLinks.listPaged({
        status: "expired",
        limit: 100,
        cursor: first.nextCursor ?? undefined,
      }),
    );
    expect(second).toEqual({ items: [], nextCursor: null });
  });

  it("rejects malformed opaque cursors instead of restarting from page one", async () => {
    await expect(
      asManager(() =>
        client.embedLinks.listPaged({ status: "active", limit: 2, cursor: "not-a-cursor" }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
