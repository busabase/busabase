import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The published `busabase-skill` drives real workspaces through `npx busabase-cli`,
 * so the commands printed in SKILL.md are a contract we must not break. This test
 * runs those exact commands end-to-end — CLI → busabase-sdk → oRPC contract →
 * busabase-core router → PGlite — with no HTTP server: `fetch` is redirected
 * in-process to the same OpenAPIHandler the `/api/v1` route mounts. If a rename or
 * refactor breaks the skill's happy path, this goes red instead of the skill.
 */

const BASE_URL = "http://localhost:15419";
const ENV_KEYS = ["BUSABASE_API_KEY", "BUSABASE_BASE_URL", "BUSABASE_SPACE_ID", "HOME"] as const;

describe("busabase-cli golden path (skill commands, in-process)", () => {
  let dataDir = "";
  let storageDir = "";
  let homeDir = "";
  const originalFetch = global.fetch;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-cli-e2e-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-cli-e2e-storage-"));
    homeDir = await mkdtemp(path.join(os.tmpdir(), "busabase-cli-e2e-home-"));
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    // Open local server: no key, and a scratch HOME so the CLI never reads a real
    // ~/.busabase/.env (which could inject an auth header and change behaviour).
    delete process.env.BUSABASE_API_KEY;
    delete process.env.BUSABASE_BASE_URL;
    delete process.env.BUSABASE_SPACE_ID;
    process.env.HOME = homeDir;

    const { seedScenario } = await import("busabase-core/logic/store");
    const { englishScenario } = await import("busabase-core/demo/dataset");
    await seedScenario(englishScenario);
    const { busabaseRouter } = await import("busabase-core/router");
    const handler = new OpenAPIHandler(busabaseRouter);
    // Contract route paths already carry the `/api/v1` prefix, so the request the
    // SDK builds (`<base>/api/v1/...`) matches without a prefix option — exactly
    // what the Next.js `/api/v1/[[...rest]]` route relies on.
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const { pathname } = new URL(request.url);
      if (!pathname.startsWith("/api/")) return originalFetch(input as RequestInfo, init);
      const result = await handler.handle(request, { context: {} });
      return result.matched
        ? result.response
        : Response.json({ error: "Not found", path: pathname }, { status: 404 });
    }) as typeof fetch;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    for (const dir of [dataDir, storageDir, homeDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  /** Run a `busabase-cli` command as `--output json` and return the parsed result. */
  const cli = async (...args: string[]): Promise<unknown> => {
    const { runCli } = await import("busabase-cli");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const exitCode = await runCli(["--base-url", BASE_URL, "--output", "json", ...args]);
      if (exitCode !== 0) {
        throw new Error(
          `busabase-cli ${args.join(" ")} exited ${exitCode}: ${err.mock.calls.join("\n")}`,
        );
      }
      const last = log.mock.calls.at(-1)?.[0];
      return typeof last === "string" ? JSON.parse(last) : last;
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  };

  it("lists the seeded bases (`busabase-cli bases list`)", async () => {
    const bases = (await cli("bases", "list")) as Array<{ slug: string }>;
    expect(bases.map((b) => b.slug)).toEqual(
      expect.arrayContaining(["blog", "social-content", "newsletter"]),
    );
  });

  it("runs the full propose → review → merge loop through the CLI", async () => {
    const bases = (await cli("bases", "list")) as Array<{ id: string; slug: string }>;
    const blog = bases.find((b) => b.slug === "blog");
    expect(blog).toBeDefined();
    const blogId = blog?.id as string;

    // 1. Propose a new record as a Change Request (the skill's core write path).
    const created = (await cli(
      "bases",
      "create-change-request",
      "--base-id",
      blogId,
      "--fields-json",
      JSON.stringify({
        title: "CLI golden path",
        channel: "blog",
        body: "Written via busabase-cli.",
        path: "/blog/cli-golden-path",
        slug: "cli-golden-path",
        locale: "en",
        status: "draft",
        "schema-version": 1,
      }),
      "--message",
      "golden path",
      "--require-review",
    )) as { id: string; status: string };
    expect(created.status).toBe("in_review");
    expect(created.id).toBeTruthy();

    // 2. Human approves.
    const reviewed = (await cli(
      "change-requests",
      "review",
      "--change-request-id",
      created.id,
      "--verdict",
      "approved",
    )) as { status: string };
    expect(reviewed.status).toBe("approved");

    // 3. Merge into the Base.
    await cli("change-requests", "merge", "--change-request-id", created.id);

    // 4. The merged record is now visible through the records endpoint.
    // `records list` is now `records query` (task layer), always paginated.
    const page = (await cli("records", "query", "--base-id", blogId, "--limit", "100")) as {
      records: unknown[];
    };
    expect(JSON.stringify(page.records)).toContain("CLI golden path");
  });

  it("surfaces the review queue (`busabase-cli change-requests list`)", async () => {
    // The listing is keyset-paginated now, so the CLI prints `{ changeRequests,
    // nextCursor }` — same shape `records list` has always returned.
    const queue = (await cli("change-requests", "list", "--limit", "100")) as {
      changeRequests: Array<{ id: string; status: string }>;
      nextCursor: string | null;
    };
    expect(Array.isArray(queue.changeRequests)).toBe(true);
    expect(queue.changeRequests.length).toBeGreaterThan(0);
  });

  it("creates a folder node Change Request through the CLI, then reviews and merges it", async () => {
    const created = (await cli(
      "nodes",
      "create-change-request",
      "--type",
      "folder",
      "--slug",
      "cli-folder",
      "--name",
      "CLI Folder",
      "--require-review",
    )) as { id: string; status: string };
    expect(created.status).toBe("in_review");

    const reviewed = (await cli(
      "change-requests",
      "review",
      "--change-request-id",
      created.id,
      "--verdict",
      "approved",
    )) as { status: string };
    expect(reviewed.status).toBe("approved");
    await cli("change-requests", "merge", "--change-request-id", created.id);

    const tree = await cli("nodes", "list");
    expect(JSON.stringify(tree)).toContain("CLI Folder");
  });

  // `records_change_request`'s endpoint has supported permission-aware auto-merge
  // on `update` since #5712, but the task that supersedes it never exposed the
  // flag — and `records_change_request` is in TASK_SUPERSEDED_MCP_TOOLS, so the
  // task is an MCP client's ONLY route to a record update. The capability was
  // unreachable, not merely undocumented. Both branches asserted here.
  it("updates a record in one call with --auto-merge, and still defers with --require-review", async () => {
    const bases = (await cli("bases", "list")) as Array<{ id: string; slug: string }>;
    const blogId = bases.find((b) => b.slug === "blog")?.id as string;
    const page = (await cli("records", "query", "--base-id", blogId, "--limit", "1")) as {
      records: Array<{ id: string }>;
    };
    const recordId = page.records[0]?.id as string;
    expect(recordId).toBeTruthy();

    const merged = (await cli(
      "records",
      "change-request",
      "--record-id",
      recordId,
      "--operation",
      "update",
      "--fields-json",
      JSON.stringify({ status: "published" }),
      "--auto-merge",
    )) as { materialized?: boolean; id: string };
    expect(merged.materialized).toBe(true);

    // The new value is canonical immediately — no review/merge call in between.
    const after = (await cli("records", "get", "--record-id", recordId)) as {
      headCommit: { payload: Record<string, unknown> };
    };
    expect(after.headCommit.payload.status).toBe("published");

    // The opposite flag must still be reachable: a CLI boolean is presence-only,
    // so `--auto-merge` alone could never express "force review".
    const proposed = (await cli(
      "records",
      "change-request",
      "--record-id",
      recordId,
      "--operation",
      "update",
      "--fields-json",
      JSON.stringify({ status: "draft" }),
      "--require-review",
    )) as { materialized?: boolean; status?: string };
    expect(proposed.materialized).toBe(false);
    expect(proposed.status).toBe("in_review");
  });

  // Views gained `autoMerge` here; assert BOTH flags reach the endpoint through
  // the task layer. `--require-review` matters on its own: a CLI boolean is
  // presence-only, so `--auto-merge` alone could never express "force review",
  // which is why the task carries the same two-flag shape as `node_create`.
  it("creates a view in one call, and still defers with --require-review", async () => {
    const bases = (await cli("bases", "list")) as Array<{ id: string; slug: string }>;
    const blogId = bases.find((b) => b.slug === "blog")?.id as string;

    const merged = (await cli(
      "views",
      "change-request",
      "--action",
      "create",
      "--base-id",
      blogId,
      "--name",
      "CLI Auto Merged",
      "--auto-merge",
    )) as { materialized?: boolean; slug?: string; status?: string };
    expect(merged.materialized).toBe(true);
    expect(merged.status).toBe("active");

    // Listed as active with no separate review/merge call at all.
    const views = (await cli("bases", "list-views", "--base-id", blogId)) as Array<{
      slug: string;
      status: string;
    }>;
    expect(views.some((v) => v.slug === merged.slug && v.status === "active")).toBe(true);

    const proposed = (await cli(
      "views",
      "change-request",
      "--action",
      "create",
      "--base-id",
      blogId,
      "--name",
      "CLI Review Please",
      "--require-review",
    )) as { materialized?: boolean; status?: string };
    expect(proposed.materialized).toBe(false);
    expect(proposed.status).toBe("in_review");
  });

  // The field and file-tree ENDPOINTS gained autoMerge, but their tasks did not
  // expose it — and `bases_field_change_request` / `file_trees_create_change_request`
  // are both in TASK_SUPERSEDED_MCP_TOOLS, so the task is an MCP client's only
  // route to either. Same unreachable-capability shape #5949 fixed for records.
  it("exposes autoMerge on the field and file-tree tasks, both directions", async () => {
    const bases = (await cli("bases", "list")) as Array<{ id: string; slug: string }>;
    const blogId = bases.find((b) => b.slug === "blog")?.id as string;

    // add is one of the four mergeable field operations.
    const merged = (await cli(
      "bases",
      "field-change-request",
      "--base-id",
      blogId,
      "--operation",
      "add",
      "--slug",
      "cli_auto_field",
      "--name",
      "CLI Auto Field",
      "--auto-merge",
    )) as { status?: string };
    expect(merged.status).toBe("merged");
    const after = (await cli("bases", "get", "--slug", "blog")) as {
      fields: Array<{ id: string; slug: string }>;
    };
    expect(after.fields.some((f) => f.slug === "cli_auto_field")).toBe(true);

    const proposed = (await cli(
      "bases",
      "field-change-request",
      "--base-id",
      blogId,
      "--operation",
      "add",
      "--slug",
      "cli_review_field",
      "--name",
      "CLI Review Field",
      "--require-review",
    )) as { status?: string };
    expect(proposed.status).toBe("in_review");

    // `delete` has no autoMerge in the endpoint schema at all — and asking for one
    // is now REJECTED with a reason rather than silently ignored, so the CLI exits
    // non-zero. That rejection is the point: a dropped flag is indistinguishable
    // from "the server chose review", which is how the original bug survived.
    const fieldId = after.fields.find((f) => f.slug === "cli_auto_field")?.id as string;
    await expect(
      cli(
        "bases",
        "field-change-request",
        "--base-id",
        blogId,
        "--operation",
        "delete",
        "--field-id",
        fieldId,
        "--auto-merge",
      ),
      // Not just "it failed": the per-issue REASON has to survive the trip to the
      // CLI surface. It did not until `explainError` learned to render
      // `data.issues` — before that the user saw only "Input validation failed",
      // which is no more actionable than the silent drop this replaced.
    ).rejects.toThrow(/soft-deletes its stored values/);

    // Without the flag the very same delete proposes normally.
    const deleteCr = (await cli(
      "bases",
      "field-change-request",
      "--base-id",
      blogId,
      "--operation",
      "delete",
      "--field-id",
      fieldId,
    )) as { status?: string };
    expect(deleteCr.status).toBe("in_review");

    // File-tree side: a non-destructive batch merges, a delete batch does not.
    // `nodes list-file-trees` returns plain NodeVOs (it is `nodes.list` scoped by type).
    const skills = (await cli("nodes", "list-file-trees", "--kind", "skill")) as Array<{
      id: string;
      slug: string;
    }>;
    const skillId = skills.find((n) => n.slug === "ai-research-editor")?.id as string;
    expect(skillId).toBeTruthy();
    const fileMerged = (await cli(
      "nodes",
      "files-change-request",
      "--kind",
      "skill",
      "--node-id",
      skillId,
      "--operations-json",
      JSON.stringify([{ kind: "create", path: "cli-auto.md", content: "x" }]),
      "--auto-merge",
    )) as { status?: string };
    expect(fileMerged.status).toBe("merged");

    // A delete batch asking to merge is rejected with a reason (and a suggested
    // remedy), not quietly downgraded.
    await expect(
      cli(
        "nodes",
        "files-change-request",
        "--kind",
        "skill",
        "--node-id",
        skillId,
        "--operations-json",
        JSON.stringify([{ kind: "delete", path: "cli-auto.md" }]),
        "--auto-merge",
      ),
    ).rejects.toThrow(/Split the deletes into their own change request/);

    const fileDelete = (await cli(
      "nodes",
      "files-change-request",
      "--kind",
      "skill",
      "--node-id",
      skillId,
      "--operations-json",
      JSON.stringify([{ kind: "delete", path: "cli-auto.md" }]),
    )) as { status?: string };
    expect(fileDelete.status).toBe("in_review");
  });

  it("runs full-text search (`busabase-cli search`)", async () => {
    const result = (await cli("search", "--query", "AI", "--limit", "5")) as {
      results: unknown[];
    };
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
  });
});
