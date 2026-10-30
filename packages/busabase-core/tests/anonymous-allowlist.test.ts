import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { beforeAll, describe, expect, it } from "vitest";
import { runWithAnonymousContext, runWithBusabaseContext } from "../src/context";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import {
  anonymousAccessKindFor,
  anonymousAllowlistSnapshot,
  isAnonymousProcedureAllowed,
  isAnonymousReadableNodeType,
  isEmbedProcedureAllowed,
} from "../src/logic/anonymous-allowlist";
import { setNodeShare } from "../src/logic/node-share";
import { seedScenario } from "../src/logic/seed";
import { busabaseRouter } from "../src/router";

/**
 * Public node sharing (plan P2): the anonymous visitor's RPC surface is an
 * explicit allowlist, enforced per-procedure so the oRPC batch endpoint cannot
 * be used to smuggle a denied call through.
 */
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

/**
 * Procedures that consult NO node ACL — they are space-scoped only, so reaching
 * any of them anonymously would leak the whole space rather than one shared
 * node. These must never appear on the allowlist.
 */
const MUST_STAY_DENIED = [
  "dump.exportTables",
  "dump.importBegin",
  "dump.importCommit",
  "vault.get",
  "vault.update",
  "vault.clear",
  "webhooks.list",
  "assets.list",
  "changeRequests.list",
  "changeRequests.merge",
  "changeRequests.review",
  "auditEvents.list",
  "auditEvents.create",
  "comments.list",
  "comments.create",
  "activity.listPaged",
  "agent.listTasks",
  "live.subscribe",
  "auth.verify",
  "nodes.principals.list",
  "nodes.principals.add",
  "nodes.principals.remove",
  // Mutations that are not on the allowlist by name.
  "nodes.createChangeRequest",
  "nodes.move",
  "nodes.purge",
  "nodes.updateVisibility",
  "nodes.updateContent",
  // The four retired typed gets. They no longer exist as procedures at all —
  // asserting they are denied keeps a re-added alias from quietly inheriting
  // anonymous access from this file's history.
  "docs.get",
  "files.get",
  "folders.get",
  "fileTrees.get",
  "bases.create",
  "records.changeRequest",
  "search",
  "grep",
  // Playbook discovery is a member's agent reading the space's procedures —
  // nothing a public link or an embed should reach.
  "playbooks.search",
  "playbooks.get",
  "playbooks.list",
];

describe("anonymous allowlist (unit)", () => {
  it("denies every space-scoped-only procedure", () => {
    for (const key of MUST_STAY_DENIED) {
      expect(
        isAnonymousProcedureAllowed(key.split(".")),
        `${key} must stay denied for anonymous visitors`,
      ).toBe(false);
    }
  });

  it("allows exactly the public read surface", () => {
    expect(anonymousAllowlistSnapshot().read).toEqual([
      "assets.readTextLines",
      "bases.get",
      "bases.list",
      "bases.listViews",
      "fileTrees.readFile",
      "forms.getByNode",
      // `docs.get` / `files.get` / `folders.get` collapsed into this one route.
      "nodes.get",
      "nodes.list",
      "nodes.resolveRouteState",
      "records.count",
      "records.get",
      "records.getMany",
      "records.groupBy",
      "records.list",
      "records.listPage",
      "records.search",
    ]);
  });

  /**
   * The distinction that used to be carried by WHICH procedure was allowlisted:
   * `folders.get` / `docs.get` / `files.get` were public, `fileTrees.get`
   * deliberately was not. Skill/Drive now expose their files when deliberately
   * shared, while AirApp continues to use its isolated runtime. Keep that
   * boundary on the resolved node type rather than trusting caller hints.
   */
  it("exposes shared detail types while keeping AirApp source behind its relay", () => {
    expect(anonymousAllowlistSnapshot().nodeTypes).toEqual([
      "base",
      "doc",
      "drive",
      "file",
      "folder",
      "form",
      "html",
      "skill",
      "whiteboard",
      "workflow",
    ]);
    for (const type of ["airapp"]) {
      expect(isAnonymousReadableNodeType(type), `${type} must stay non-anonymous`).toBe(false);
    }
    for (const type of [
      "folder",
      "doc",
      "file",
      "base",
      "form",
      "whiteboard",
      "workflow",
      "html",
      "skill",
      "drive",
    ]) {
      expect(isAnonymousReadableNodeType(type), `${type} must stay anonymous-readable`).toBe(true);
    }
  });

  it("fails closed on a node type nobody has decided about", () => {
    // A late `registerNodeType()` plugin type must not inherit public access.
    expect(isAnonymousReadableNodeType("brand-new-plugin-type")).toBe(false);
    expect(isAnonymousReadableNodeType("airapp")).toBe(false);
  });

  it("classifies forms.submit as submit-only, never as read", () => {
    expect(anonymousAccessKindFor(["forms", "submit"])).toBe("submit");
    expect(anonymousAccessKindFor(["nodes", "list"])).toBe("read");
  });

  it("fails closed on an unknown / newly added procedure", () => {
    expect(anonymousAccessKindFor(["something", "brandNew"])).toBeNull();
    // A prefix of an allowed key must not inherit its access.
    expect(anonymousAccessKindFor(["records"])).toBeNull();
    expect(anonymousAccessKindFor(["nodes", "list", "extra"])).toBeNull();
  });

  it("still resolves when the router is mounted under a host prefix", () => {
    // busabase-cloud composes this router under a `core` key, so middleware
    // sees `core.nodes.list`, not `nodes.list`. Matching the full path made
    // every anonymous request fail closed — the public page could never load.
    // Caught only by a real HTTP round-trip; the in-process test client mounts
    // at the root and never reproduces it. Keep this locked down.
    expect(anonymousAccessKindFor(["core", "nodes", "list"])).toBe("read");
    expect(anonymousAccessKindFor(["core", "records", "list"])).toBe("read");
    expect(anonymousAccessKindFor(["core", "records", "listPage"])).toBe("read");
    expect(anonymousAccessKindFor(["core", "forms", "submit"])).toBe("submit");
    // Denials must survive the prefix too.
    expect(anonymousAccessKindFor(["core", "vault", "get"])).toBeNull();
    expect(anonymousAccessKindFor(["core", "dump", "exportTables"])).toBeNull();
  });
});

describe("embed allowlist (unit)", () => {
  it("allows exactly the embed read surface", () => {
    expect(anonymousAllowlistSnapshot().embed).toEqual([
      "bases.get",
      "bases.list",
      "bases.listViews",
      "changeRequests.get",
      "fileTrees.get",
      "fileTrees.preparePreview",
      "fileTrees.previewConfig",
      "fileTrees.readFile",
      "nodes.get",
      "nodes.list",
      "nodes.resolveRouteState",
      // Node-ACL'd aggregates an embedded AirApp dashboard renders from.
      "records.count",
      "records.get",
      "records.getMany",
      "records.groupBy",
      "records.list",
      "records.listPage",
      "records.search",
    ]);
  });

  it.each([["records.count"], ["records.groupBy"], ["records.search"], ["records.listPage"]])(
    "lets an embed reach the node-ACL'd read %s, under the cloud mount too",
    (key) => {
      expect(isEmbedProcedureAllowed(key.split("."))).toBe(true);
      expect(isEmbedProcedureAllowed(["core", ...key.split(".")])).toBe(true);
    },
  );

  it("still refuses the space-scoped surface to an embed", () => {
    for (const key of [
      "changeRequests.list",
      "comments.list",
      "comments.create",
      "auditEvents.list",
      "activity.listPaged",
      "dump.exportTables",
      "vault.get",
      "webhooks.list",
      "assets.list",
      "agent.listTasks",
      "search",
      "grep",
      "records.changeRequest",
      "records.listChangeRequests",
    ]) {
      expect(isEmbedProcedureAllowed(key.split(".")), `${key} must stay denied for embeds`).toBe(
        false,
      );
    }
  });

  it("allows ACL-filtered reads for public shares without exposing ordinary auth", () => {
    for (const key of ["bases.list", "records.count", "records.groupBy", "records.search"]) {
      expect(isAnonymousProcedureAllowed(key.split(".")), key).toBe(true);
    }
    expect(isAnonymousProcedureAllowed(["auth", "verify"])).toBe(false);
    expect(isEmbedProcedureAllowed(["auth", "verify"])).toBe(false);
  });
});

describe("anonymous allowlist (router enforcement)", () => {
  let client: ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

  beforeAll(async () => {
    process.chdir(MIGRATIONS_CWD);
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-anon-db-"));
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-anon-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
  }, 120_000);

  it("rejects a denied procedure for an anonymous visitor", async () => {
    await runWithAnonymousContext({}, async () => {
      await expect(client.dump.exportTables({ tables: ["busabase_nodes"] })).rejects.toThrow(
        /anonymous/i,
      );
      await expect(client.vault.get()).rejects.toThrow(/anonymous/i);
      await expect(client.auditEvents.list({})).rejects.toThrow(/anonymous/i);
      await expect(client.changeRequests.list({})).rejects.toThrow(/anonymous/i);
    });
  });

  it("still serves those same procedures to a member", async () => {
    await runWithBusabaseContext({}, async () => {
      // The guard must be a strict no-op off the anonymous path — if this
      // breaks, the gate has started restricting real members.
      await expect(client.auditEvents.list({})).resolves.toBeDefined();
      await expect(client.changeRequests.list({})).resolves.toBeDefined();
    });
  });

  it("allows an allowlisted read, ACL-filtered down to shared nodes only", async () => {
    const unshared = await runWithAnonymousContext({}, () => client.nodes.list({}));
    // Nothing is shared yet, so the allowed procedure returns an empty tree
    // rather than the space's nodes — allowlisting grants reachability, the
    // node ACL still decides visibility.
    expect(unshared).toEqual([]);

    const rootId = await runWithBusabaseContext({}, async () => {
      const nodes = (await client.nodes.list({})) as Array<{ id: string }>;
      const id = nodes[0]?.id ?? "";
      await setNodeShare(id, { scope: "public", capability: "read" });
      return id;
    });

    const shared = (await runWithAnonymousContext({}, () => client.nodes.list({}))) as Array<{
      id: string;
    }>;
    expect(shared.map((node) => node.id)).toContain(rootId);
  });
});
