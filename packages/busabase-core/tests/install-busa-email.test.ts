import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { APP_ROOT_RESOURCE_KEY } from "busabase-contract/domains/package/template";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { BUSABASE_MCP_APPS_TOPIC, busabaseMcpGuideTool } from "../src/mcp-skill";
import { busabaseRouter } from "../src/router";

/**
 * The reference template, installed for real.
 *
 * Every other test in this suite builds a package to suit itself. This one
 * installs `busabase/templates`' actual `busa-email` — 90 files, three Bases,
 * ninety-seven fields, a Drive and an AirApp written by a person rather than by
 * a fixture. The synthetic packages prove the code paths; only a real one proves
 * they survive contact with a real app.
 *
 * SKIPPED when the checkout is absent, so this never turns someone else's clone
 * red for a reason that has nothing to do with their change.
 */

const BUSA_EMAIL = path.join(os.homedir(), "Documents/busabase-templates/templates/busa-email");
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const present = async (dir: string): Promise<boolean> => {
  try {
    await readdir(dir);
    return true;
  } catch {
    return false;
  }
};

const readTree = async (
  dir: string,
  root: string,
  out: Map<string, Buffer>,
): Promise<Map<string, Buffer>> => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) await readTree(abs, root, out);
    else out.set(path.relative(root, abs).split(path.sep).join("/"), await readFile(abs));
  }
  return out;
};

const describeIfPresent = (await present(BUSA_EMAIL)) ? describe : describe.skip;

describeIfPresent("install.fromGithub — the real busa-email template", () => {
  let client: Client;
  let dataDir: string | undefined;
  let storageDir: string | undefined;
  let originalCwd: string | undefined;
  const originalFetch = global.fetch;
  const SPACE = "space_busa_email";

  let folder:
    | {
        id: string;
        metadata?: unknown;
        children?: {
          slug: string;
          type: string;
          id: string;
          baseId?: string | null;
          metadata?: unknown;
        }[];
      }
    | undefined;
  let result: {
    created: Record<string, number>;
    pendingChangeRequests: number;
    warnings: string[];
  };

  const inSpace = <T>(fn: () => Promise<T>): Promise<T> =>
    runWithBusabaseContext({ spaceId: SPACE }, fn);

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-busa-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-busa-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await runWithBusabaseContext({ spaceId: "space_busa_warmup" }, () => client.nodes.list());

    const files = await readTree(BUSA_EMAIL, BUSA_EMAIL, new Map());
    const writer = new ZipWriter(new BlobWriter("application/zip"));
    for (const [relativePath, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
      await writer.add(`templates-main/${relativePath}`, new BlobReader(new Blob([bytes])));
    }
    const zipball = Buffer.from(await (await writer.close()).arrayBuffer());

    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("https://codeload.github.com/")) {
        return new Response(new Uint8Array(zipball), {
          status: 200,
          headers: { "content-type": "application/zip" },
        });
      }
      return originalFetch(input as RequestInfo, init);
    }) as typeof fetch;

    result = (await inSpace(() =>
      client.install.fromGithub({
        repoUrl: "https://github.com/busabase/templates",
        // The default a user gets: review-first. Everything asserted below
        // happens WITHOUT being told to skip review.
        autoMerge: false,
      }),
    )) as typeof result;

    const nodes = await inSpace(() => client.nodes.list());
    const roots = nodes.length === 1 && nodes[0].children ? nodes[0].children : nodes;
    folder = roots.find((node) => node.slug === "busa-email") as typeof folder;
  }, 120_000);

  afterAll(async () => {
    global.fetch = originalFetch;
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("installs the whole app without a warning", () => {
    expect(result.warnings).toEqual([]);
    expect(result.created.bases).toBe(3);
  });

  it("creates the three Bases folder-prefixed", () => {
    const bases = (folder?.children ?? [])
      .filter((node) => node.type === "base")
      .map((node) => node.slug)
      .sort();
    expect(bases).toEqual(["busa-email-contacts", "busa-email-reviews", "busa-email-settings"]);
  });

  it("carries every one of the app's 97 fields", async () => {
    const counts: Record<string, number> = {};
    for (const node of folder?.children ?? []) {
      if (node.type !== "base" || !node.baseId) continue;
      const base = await inSpace(() => client.bases.get({ baseId: node.baseId as string }));
      counts[node.slug] = base.fields.length;
    }
    expect(counts).toEqual({
      "busa-email-reviews": 65,
      "busa-email-contacts": 22,
      "busa-email-settings": 10,
    });
  });

  it("stamps everything as this app's, using the slugs the package declared", () => {
    expect(folder?.metadata).toMatchObject({
      appId: "busa-email",
      resourceKey: APP_ROOT_RESOURCE_KEY,
      schemaVersion: 3,
    });
    const stamps = Object.fromEntries(
      (folder?.children ?? []).map((node) => [
        node.slug,
        (node.metadata as { resourceKey?: string })?.resourceKey,
      ]),
    );
    // The app's own code looks its tables up by these keys — not by the
    // prefixed slugs they installed under.
    expect(stamps).toMatchObject({
      "busa-email-reviews": "reviews",
      "busa-email-contacts": "contacts",
      "busa-email-settings": "settings",
    });
  });

  it("opens with the demo rows already live, not waiting in review", async () => {
    const reviews = (folder?.children ?? []).find((node) => node.slug === "busa-email-reviews");
    const records = await inSpace(() => client.records.list({ baseId: reviews?.baseId as string }));
    const subjects = records.records.map(
      (row) => (row.headCommit?.payload as { subject?: string } | undefined)?.subject,
    );
    expect(subjects).toContain("Invoice #4021 is overdue");
    expect(records.records).toHaveLength(4);
  });

  it("holds every file-tree node for review — this is a stranger's code", () => {
    // The AirApp (a Node project), the Skill (instructions an agent follows),
    // and the Drive all wait for a human. Only the structure and the demo rows
    // went live; nothing that runs or instructs did.
    for (const type of ["airapp", "skill", "drive"]) {
      expect(
        (folder?.children ?? []).some((node) => node.type === type),
        `${type} must not be live on a review-first install`,
      ).toBe(false);
    }
    expect(result.pendingChangeRequests).toBe(3);
  });

  it("hands an agent the manual its author actually wrote, once reviewed", async () => {
    // Merge the pending requests the way a human would, then check what an
    // agent connected to this workspace can now read.
    const pending = await inSpace(() => client.changeRequests.list({ status: ["in_review"] }));
    const ids = pending.changeRequests.map((request) => request.id);
    await inSpace(() =>
      client.changeRequests.review({ changeRequestIds: ids, verdict: "approved" }),
    );
    await inSpace(() => client.changeRequests.merge({ changeRequestIds: ids }));

    const tool = busabaseMcpGuideTool(["workspace", "airapp", BUSABASE_MCP_APPS_TOPIC], {
      spaceTargeting: false,
    });
    const listed = (await inSpace(() =>
      tool.execute(client as never, { topic: BUSABASE_MCP_APPS_TOPIC }),
    )) as { apps: { slug: string; readWith: string }[] };
    expect(listed.apps.map((app) => app.slug)).toEqual(["busa-email"]);

    const manual = (await inSpace(() =>
      tool.execute(client as never, { topic: listed.apps[0].readWith }),
    )) as { content: string };
    // Kelly's own words, from the skill's real SKILL.md and its references.
    expect(manual.content).toContain("Busa Email is a Busabase Cloud App-in-Skill");
    expect(manual.content).toContain("references/batch-schema.md");
  });

  it("never carries a real workspace's ids into a published package", async () => {
    // `resource-map.json` records the node ids of whichever space last ran
    // setup. It is runtime state, not part of the app, and publishing it would
    // ship one person's workspace layout to everyone who installs.
    const files = await readTree(BUSA_EMAIL, BUSA_EMAIL, new Map());
    for (const [name, bytes] of files) {
      expect(name).not.toContain("resource-map.json");
      expect(bytes.toString("utf8")).not.toMatch(/\bnod[a-z0-9]{10,}\b/);
    }
  });
});
