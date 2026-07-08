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
      }),
      "--message",
      "golden path",
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
    const page = (await cli("records", "list", "--base-id", blogId, "--limit", "100")) as {
      records: unknown[];
    };
    expect(JSON.stringify(page.records)).toContain("CLI golden path");
  });

  it("surfaces the review queue (`busabase-cli change-requests list`)", async () => {
    const queue = (await cli("change-requests", "list", "--limit", "100")) as Array<{
      id: string;
      status: string;
    }>;
    expect(Array.isArray(queue)).toBe(true);
    expect(queue.length).toBeGreaterThan(0);
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

  it("runs full-text search (`busabase-cli search`)", async () => {
    const result = (await cli("search", "--query", "AI", "--limit", "5")) as {
      results: unknown[];
    };
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
  });
});
