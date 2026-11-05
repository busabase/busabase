/**
 * The host's plan limit on nodes and records, against a real PGLite database.
 *
 * Core rations nothing itself: it asks the host's `creationLimit` how much a write is about
 * to add. These tests stand in for the host with a refusing hook, and check the question
 * reaches it on each path that creates something, and what a refusal leaves behind.
 */
import { createRouterClient, ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BusabaseCreationCounts,
  type BusabaseCreationLimit,
  LOCAL_SPACE_ID,
  runWithBusabaseContext,
} from "../src/context";
import { getDb } from "../src/db";
import { busabaseChangeRequests, busabaseNodes } from "../src/db/schema";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const refusal = () =>
  new ORPCError("FORBIDDEN", {
    message: "This space has reached its plan's limit",
    data: { code: "USAGE_LIMIT_EXCEEDED", label: "Nodes", used: 20, limit: 20 },
  });

describe("plan limits on creation", () => {
  let raw: RawClient;
  let baseId = "";
  const hook = vi.fn<(added: BusabaseCreationCounts) => Promise<void>>();
  /** What the host does around a guarded write, so a test can see what core put inside it. */
  let aroundWrite: (write: () => Promise<unknown>) => Promise<unknown> = (write) => write();
  const creationLimit: BusabaseCreationLimit = {
    check: hook,
    // Checked inside, like a real host: the check and the write share one critical section.
    guard: async (added, write) =>
      aroundWrite(async () => {
        await hook(added);
        return write();
      }) as ReturnType<typeof write>,
  };

  /** A manager on a host with a limit: everything they write would merge immediately. */
  const asHost = <T>(fn: () => Promise<T>) =>
    runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "alice",
        isSpaceManager: true,
        creationLimit,
      },
      fn,
    );
  const slug = (name: string) =>
    `${name.toLowerCase().replaceAll(" ", "-")}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const createFolder = (name: string, autoMerge?: boolean) =>
    raw.nodes.createChangeRequest({
      ...(autoMerge === undefined ? {} : { autoMerge }),
      operations: [{ kind: "create", nodeType: "folder", slug: slug(name), name }],
    });
  const nodeExists = async (name: string) => {
    const db = await getDb();
    const rows = await db.select().from(busabaseNodes).where(eq(busabaseNodes.name, name));
    return rows.length > 0;
  };

  /** The Change Requests a step left behind. */
  const changeRequestsFrom = async (step: () => Promise<unknown>) => {
    const db = await getDb();
    const read = () =>
      db
        .select({ id: busabaseChangeRequests.id, status: busabaseChangeRequests.status })
        .from(busabaseChangeRequests);
    const before = new Set((await read()).map((row) => row.id));
    await step();
    return (await read()).filter((row) => !before.has(row.id));
  };

  beforeAll(async () => {
    await seedScenario("creation-limits");
    raw = createRouterClient(busabaseRouter);
    hook.mockResolvedValue(undefined);
    await asHost(async () => {
      await raw.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          {
            kind: "create",
            nodeType: "base",
            slug: "limits",
            name: "Limits",
            fields: [{ slug: "title", name: "Title", type: "text" }],
          },
        ],
      });
      const tree = await raw.nodes.list();
      const flat = (nodes: typeof tree): typeof tree =>
        nodes.flatMap((node) => [node, ...flat(node.children)]);
      baseId = flat(tree).find((node) => node.slug === "limits")?.id ?? "";
    });
  });

  beforeEach(() => {
    hook.mockReset();
    hook.mockResolvedValue(undefined);
    aroundWrite = (write) => write();
  });

  it("asks before a folder is created, and creates it when the plan allows", async () => {
    const name = "Allowed folder";
    await asHost(() => createFolder(name));
    expect(hook).toHaveBeenCalledWith({ nodes: 1 });
    expect(await nodeExists(name)).toBe(true);
  });

  it("creates nothing when the plan refuses, and leaves no Change Request to land later", async () => {
    hook.mockRejectedValue(refusal());
    const name = "Refused folder";
    let error: unknown;
    const left = await changeRequestsFrom(async () => {
      error = await asHost(() => createFolder(name)).catch((e: unknown) => e);
    });

    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, { code: string }>).data.code).toBe("USAGE_LIMIT_EXCEEDED");
    expect(await nodeExists(name)).toBe(false);
    // Nothing at all: a Change Request here would show in the activity feed as if
    // the folder had been created.
    expect(left).toEqual([]);
  });

  it("counts a batch as one question, so it is all or nothing", async () => {
    await asHost(() =>
      raw.nodes.createChangeRequest({
        operations: [
          { kind: "create", nodeType: "folder", slug: slug("batch-a"), name: "Batch A" },
          { kind: "create", nodeType: "folder", slug: slug("batch-b"), name: "Batch B" },
        ],
      }),
    );
    expect(hook).toHaveBeenCalledWith({ nodes: 2 });
  });

  it("asks before a record is created", async () => {
    hook.mockRejectedValue(refusal());
    await expect(
      asHost(() => raw.bases.createChangeRequest({ baseId, fields: { title: "Refused" } })),
    ).rejects.toMatchObject({ data: { code: "USAGE_LIMIT_EXCEEDED" } });
    expect(hook).toHaveBeenCalledWith({ records: 1 });
  });

  it("asks once for a whole bulk write", async () => {
    hook.mockRejectedValue(refusal());
    await expect(
      asHost(() =>
        raw.bases.createBulkChangeRequest({
          baseId,
          records: [{ title: "A" }, { title: "B" }, { title: "C" }],
        }),
      ),
    ).rejects.toMatchObject({ data: { code: "USAGE_LIMIT_EXCEEDED" } });
    expect(hook).toHaveBeenCalledWith({ records: 3 });
  });

  it("abandons a direct write the merge refuses, so it cannot land later", async () => {
    // Allowed when asked up front, refused at the merge: the space filled up in between.
    hook.mockResolvedValueOnce(undefined);
    hook.mockRejectedValue(refusal());
    const name = "Raced folder";
    const left = await changeRequestsFrom(() =>
      expect(asHost(() => createFolder(name))).rejects.toMatchObject({
        data: { code: "USAGE_LIMIT_EXCEEDED" },
      }),
    );

    expect(await nodeExists(name)).toBe(false);
    expect(left.map((row) => row.status)).toEqual(["abandoned"]);
  });

  it("lets a proposal wait for free, and asks when someone merges it", async () => {
    const proposal = await asHost(() => createFolder("Proposed folder", false));
    expect(hook).not.toHaveBeenCalled();

    const changeRequestId = (proposal as { id: string }).id;
    await asHost(() =>
      raw.changeRequests.review({ changeRequestIds: [changeRequestId], verdict: "approved" }),
    );

    hook.mockRejectedValue(refusal());
    const refused = await asHost(() =>
      raw.changeRequests.merge({ changeRequestIds: [changeRequestId] }),
    );
    expect(refused.results[0]).toMatchObject({
      ok: false,
      data: { code: "USAGE_LIMIT_EXCEEDED" },
    });

    // A human's merge stays approved: upgrade, and the same click works.
    const db = await getDb();
    const [row] = await db
      .select({ status: busabaseChangeRequests.status })
      .from(busabaseChangeRequests)
      .where(eq(busabaseChangeRequests.id, changeRequestId));
    expect(row?.status).toBe("approved");

    hook.mockResolvedValue(undefined);
    await asHost(() => raw.changeRequests.merge({ changeRequestIds: [changeRequestId] }));
    expect(await nodeExists("Proposed folder")).toBe(true);
  });

  it("asks on the direct paths that skip Change Requests", async () => {
    hook.mockRejectedValue(refusal());
    await expect(
      asHost(() => raw.docs.create({ slug: slug("doc"), name: "Refused doc", body: "x" })),
    ).rejects.toMatchObject({ data: { code: "USAGE_LIMIT_EXCEEDED" } });
    expect(await nodeExists("Refused doc")).toBe(false);

    await expect(
      asHost(() =>
        raw.bases.create({
          slug: slug("base"),
          name: "Refused base",
          fields: [{ slug: "title", name: "Title", type: "text" }],
        }),
      ),
    ).rejects.toMatchObject({ data: { code: "USAGE_LIMIT_EXCEEDED" } });
    expect(await nodeExists("Refused base")).toBe(false);
  });

  it("changes nothing for a host with no limit", async () => {
    const name = "Unlimited folder";
    await runWithBusabaseContext(
      { spaceId: LOCAL_SPACE_ID, actorId: "alice", isSpaceManager: true },
      () => createFolder(name),
    );
    expect(await nodeExists(name)).toBe(true);
  });

  describe("the host's guard", () => {
    it("holds around the whole merge, so a count and its commit cannot be pulled apart", async () => {
      const name = "Guarded folder";
      const seen: string[] = [];
      aroundWrite = async (write) => {
        seen.push(`enter:${await nodeExists(name)}`);
        const result = await write();
        seen.push(`exit:${await nodeExists(name)}`);
        return result;
      };

      await asHost(() => createFolder(name));

      // Absent when the guard is entered and committed by the time it is left: nothing
      // else in this space can be counted between the two.
      expect(seen).toEqual(["enter:false", "exit:true"]);
    });

    it.each([
      [
        "a doc",
        "Direct doc",
        () => raw.docs.create({ slug: slug("direct-doc"), name: "Direct doc", body: "x" }),
      ],
      [
        "a base",
        "Direct base",
        () =>
          raw.bases.create({
            slug: slug("direct-base"),
            name: "Direct base",
            fields: [{ slug: "title", name: "Title", type: "text" }],
          }),
      ],
      [
        // A lookup field makes the base materialize in a transaction; the guard has to
        // outlast its commit, not just the node insert inside it.
        "a base with a lookup field",
        "Direct lookup base",
        () =>
          raw.bases.create({
            slug: slug("direct-lookup-base"),
            name: "Direct lookup base",
            fields: [
              {
                slug: "limits",
                name: "Limits",
                type: "relation",
                options: { targetBaseSlug: "limits", multiple: true },
              },
              {
                slug: "titles",
                name: "Titles",
                type: "lookup",
                options: {
                  lookup: {
                    relationFieldSlug: "limits",
                    targetFieldSlug: "title",
                    rollup: "values",
                  },
                },
              },
            ],
          }),
      ],
    ])(
      "holds around the insert of %s, which never goes through a merge",
      async (_kind, name, create) => {
        const seen: string[] = [];
        aroundWrite = async (write) => {
          seen.push(`enter:${await nodeExists(name)}`);
          const result = await write();
          seen.push(`exit:${await nodeExists(name)}`);
          return result;
        };

        await asHost(create);

        expect(seen).toEqual(["enter:false", "exit:true"]);
      },
    );

    it("lets a host that queues its guard hold a limit against writers in parallel", async () => {
      let tail: Promise<unknown> = Promise.resolve();
      const LIMIT = 3;
      aroundWrite = (write) => {
        const run = tail.then(write);
        tail = run.catch(() => undefined);
        return run;
      };
      const countCreated = async () => {
        const db = await getDb();
        return (await db.select().from(busabaseNodes)).filter((row) =>
          row.name.startsWith("Parallel"),
        ).length;
      };
      hook.mockImplementation(async (added) => {
        if ((await countCreated()) + (added.nodes ?? 0) > LIMIT) throw refusal();
      });

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) => asHost(() => createFolder(`Parallel ${i}`))),
      );

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(LIMIT);
      expect(await countCreated()).toBe(LIMIT);
    });

    it("is not asked again when a merge that already happened is retried", async () => {
      const name = "Merged once";
      const merged = await asHost(() => createFolder(name));
      const changeRequestId = (merged as { id: string }).id;

      hook.mockReset();
      hook.mockRejectedValue(refusal());
      const again = await asHost(() =>
        raw.changeRequests.merge({ changeRequestIds: [changeRequestId] }),
      );

      expect(again.results[0]).toMatchObject({ ok: true });
      expect(hook).not.toHaveBeenCalled();
    });
  });
});
