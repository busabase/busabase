import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EXIT_CODES } from "./errors";
import { buildProgram, HELP, HELP_ALL, runCli } from "./run";

const originalFetch = global.fetch;

// Isolate HOME so config resolution (and built-in auto-refresh) never reads the real
// ~/.busabase/.env — otherwise a machine-local token could inject headers or an extra
// refresh call and make these assertions non-deterministic.
let suiteHome: string;
let suiteOriginalHome: string | undefined;

beforeAll(async () => {
  suiteOriginalHome = process.env.HOME;
  suiteHome = await mkdtemp(join(tmpdir(), "busabase-suite-home-"));
  process.env.HOME = suiteHome;
});

afterAll(async () => {
  process.env.HOME = suiteOriginalHome;
  await rm(suiteHome, { force: true, recursive: true });
});

const requestBody = async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return request.json();
  const text = await request.text();
  return text || null;
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });

describe("busabase-cli commands", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("documents node and terminal Change Request commands in help", () => {
    // Rendered from the shared task definition (`busabase-contract/tasks`), which
    // derives the type list from CREATABLE_NODE_TYPES so it cannot drift.
    expect(HELP).toContain(
      "nodes create --type <folder|base|skill|drive|airapp|file|doc|form|whiteboard|workflow|html>",
    );
    expect(HELP).toContain("--asset-id <value>");
    expect(HELP).toContain("change-requests close --change-request-id <id>");
    // `records list` is now `records query`, rendered from the shared task layer
    // and always hitting the paginated endpoint.
    expect(HELP).toContain("records query");
    expect(HELP).toContain(
      "records get-by-field --base-id <id> --field-slug <slug> --value-text <value>",
    );
    expect(HELP).toContain("assets upload --file <path>");
    expect(HELP).not.toContain("attachments upload");
    expect(HELP).toContain("rejected = request changes, not terminal");
    expect(HELP).not.toContain(["create", "dra", "ft"].join("-"));
    expect(HELP).not.toContain(["dra", "fts "].join(""));
    expect(HELP).not.toContain(["--dra", "ft-id"].join(""));
    expect(HELP).not.toContain("--attachment-id <id>");
    expect(HELP).not.toContain("--content-hash <hash>");
    expect(HELP).toContain(
      "records bulk-update-change-request --base-id <value> --updates-json <json|@file>",
    );
  });

  it("requires the bulk-update JSON before dispatching a request", async () => {
    global.fetch = vi.fn() as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "records",
      "bulk-update-change-request",
      "--base-id",
      "bas_1",
    ]);

    // A missing required flag is a usage error, which now has its own exit code.
    expect(exitCode).toBe(EXIT_CODES.USAGE);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("gets a Base by id or slug with one direct request", async () => {
    const urls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      urls.push(request.url);
      return jsonResponse({ id: "bse_1", slug: "campaigns" });
    }) as typeof fetch;

    expect(
      await runCli(["--base-url", "http://localhost:15419", "bases", "get", "--base-id", "bse_1"]),
    ).toBe(0);
    expect(
      await runCli(["--base-url", "http://localhost:15419", "bases", "get", "--slug", "campaigns"]),
    ).toBe(0);
    expect(urls).toEqual([
      "http://localhost:15419/api/v1/bases/bse_1",
      "http://localhost:15419/api/v1/bases/campaigns",
    ]);
  });

  it("requires exactly one Base selector before sending a request", async () => {
    global.fetch = vi.fn() as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await runCli(["--base-url", "http://localhost:15419", "bases", "get"])).toBe(
      EXIT_CODES.VALIDATION,
    );
    expect(
      await runCli([
        "--base-url",
        "http://localhost:15419",
        "bases",
        "get",
        "--slug",
        "campaigns",
        "--base-id",
        "bse_1",
      ]),
    ).toBe(EXIT_CODES.VALIDATION);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("accepts both short and full API paths without doubling the prefix", async () => {
    const urls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      urls.push(request.url);
      return jsonResponse([]);
    }) as typeof fetch;

    for (const path of ["/bases", "/api/v1/bases"]) {
      expect(
        await runCli([
          "--base-url",
          "http://localhost:15419",
          "api",
          "--method",
          "get",
          "--path",
          path,
        ]),
      ).toBe(0);
    }
    expect(urls).toEqual([
      "http://localhost:15419/api/v1/bases",
      "http://localhost:15419/api/v1/bases",
    ]);
  });

  it("updates a node description through a permission-aware Change Request", async () => {
    const calls: Array<{ body: unknown; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({ body: await requestBody(request), url: request.url });
      return jsonResponse({ id: "crq_1", status: "in_review" });
    }) as typeof fetch;

    expect(
      await runCli([
        "--base-url",
        "http://localhost:15419",
        "nodes",
        "update-description",
        "--node-id",
        "nod_1",
        "--description",
        "Campaign resources",
        "--message",
        "Refresh folder summary",
      ]),
    ).toBe(0);
    expect(calls).toEqual([
      {
        url: "http://localhost:15419/api/v1/nodes/change-requests",
        body: {
          operations: [{ kind: "rename", nodeId: "nod_1", description: "Campaign resources" }],
          message: "Refresh folder summary",
        },
      },
    ]);
  });

  it("shows a dry-run description update without making a request", async () => {
    global.fetch = vi.fn() as typeof fetch;
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value: unknown) => {
      output.push(String(value));
    });

    expect(
      await runCli([
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
        "nodes",
        "update-description",
        "--node-id",
        "nod_1",
        "--description",
        "Campaign resources",
        "--dry-run",
      ]),
    ).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(output.join("\n")).toContain("http://localhost:15419/api/v1/nodes/change-requests");
  });

  it("documents the node description command", async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    });
    expect(await runCli(["nodes", "update-description", "--help"])).toBe(0);
    expect(output.join("")).toContain("--node-id <id>");
    expect(output.join("")).toContain("--description <text>");
    expect(output.join("")).toContain("--dry-run");
    expect(output.join("")).toContain("it merges with write access");
  });

  it("documents the default-space login policy for agents", async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    });

    expect(await runCli(["login", "--help"])).toBe(0);
    expect(output.join("")).not.toContain("--use-default-space");
    expect(output.join("")).toMatch(/never blocks on a Space question/);
    expect(output.join("")).toContain("busabase-cli space use <id>");
  });

  it("generates commands for the full OpenAPI surface (previously uncovered domains)", () => {
    // Asserted against HELP_ALL: some of these are superseded by a task command
    // and so are hidden from the index. Hidden is not gone — they still run, and
    // the point here is that the generator EMITS them.
    const HELP = HELP_ALL;
    // Record write/delete — the biggest gap the generator fills.
    expect(HELP).toContain("records update-change-request");
    expect(HELP).toContain("records delete-change-request");
    // Whole domains that had no curated command.
    expect(HELP).toContain("assets list");
    expect(HELP).toContain("assets update-metadata");
    expect(HELP).toContain("docs create");
    expect(HELP).toContain("files create");
    expect(HELP).toContain("files get");
    expect(HELP).toContain("skills read-file");
    expect(HELP).toContain("views delete-change-request");
    expect(HELP).toContain("comments create");
    expect(HELP).toContain("users me");
    // Webhook automation domain (whole domain has no curated commands).
    expect(HELP).toContain("webhooks list");
    expect(HELP).toContain("webhooks get --id <value>");
    expect(HELP).toContain("webhooks delete --id <value>");
    expect(HELP).toContain("webhooks test-fire --id <value>");
    expect(HELP).toContain("webhooks deliveries --rule-id <value>");
    // create/update take a top-level discriminated-union input (no per-field
    // shape to introspect), so the generator must fall back to a single JSON
    // flag for the whole payload instead of silently emitting zero flags.
    expect(HELP).toContain("webhooks create --input-json <json|@file>");
    expect(HELP).toContain("webhooks update --input-json <json|@file>");
  });

  it("keeps curated commands over generated duplicates", () => {
    // records.search / records.listChangeRequests are aliased by curated commands,
    // so the generator must NOT emit `records search` / `records list-change-requests`.
    expect(HELP).toContain("records by-field-text");
    expect(HELP).toContain("records change-requests --record-id <id>");
    expect(HELP).not.toContain("records search ");
    expect(HELP).not.toContain("records list-change-requests");
    // `airapps files` now comes from the shared task layer's CLI variant rather
    // than a hand-written command (placeholders there are uniformly `<value>`),
    // and it still has to win over the generator's `airapps list-files`.
    expect(HELP).toContain("airapps files --node-id <value>");
    expect(HELP).not.toContain("airapps list-files");
  });

  it("keeps docs/files/folders list+get, and says list is now summaries only", () => {
    // `GET /docs`, `/files`, `/folders` and their `/{nodeId}` gets are retired.
    // The commands people already type survive as a curated facade over the
    // unified Node surface rather than disappearing from the CLI.
    for (const group of ["docs", "files", "folders"]) {
      expect(HELP).toContain(`${group} list`);
      expect(HELP).toContain(`${group} get --node-id <id>`);
    }
    // The one real behaviour change is stated in `--help`, not discovered at
    // runtime by a caller reading a field that is no longer populated.
    expect(HELP).toContain("List Doc nodes — summaries only (no bodies)");
    expect(HELP).toContain("List File nodes — summaries only (no Asset detail)");
    expect(HELP).toContain("List Folder nodes — summaries only (no children)");
    // Same story for the file-tree kinds, which the task layer renders.
    expect(HELP).toContain("List Skill nodes (summaries;");
    expect(HELP).not.toContain("with their file trees");
  });

  it("serves docs/files/folders list+get from /nodes with exactly one request each", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({ method: request.method, url: request.url });
      return jsonResponse([]);
    }) as typeof fetch;

    for (const [group, type] of [
      ["docs", "doc"],
      ["files", "file"],
      ["folders", "folder"],
    ] as const) {
      expect(
        await runCli(["--base-url", "http://localhost:15419", "--output", "json", group, "list"]),
      ).toBe(0);
      expect(
        await runCli([
          "--base-url",
          "http://localhost:15419",
          "--output",
          "json",
          group,
          "get",
          "--node-id",
          "nod_1",
        ]),
      ).toBe(0);
      expect(calls).toEqual([
        {
          method: "GET",
          url: `http://localhost:15419/api/v1/nodes?types%5B0%5D=${type}`,
        },
        { method: "GET", url: `http://localhost:15419/api/v1/nodes/nod_1?type=${type}` },
      ]);
      // One request per command — a facade that fanned out a detail call per
      // listed row to rebuild the retired payload would show up right here.
      calls.length = 0;
    }
  });

  it("routes a generated GET command to the right method and path", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({ method: request.method, url: request.url });
      return jsonResponse([]);
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "assets",
      "list",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([{ method: "GET", url: "http://localhost:15419/api/v1/assets" }]);
  });

  it("keeps records get-by-field on the canonical get route with nullable output", async () => {
    const calls: Request[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push(request);
      return new Response(JSON.stringify({ error: "Record not found", code: "NOT_FOUND" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "records",
      "get-by-field",
      "--base-id",
      "bse_1",
      "--field-slug",
      "slug",
      "--value-text",
      "missing value",
    ]);

    expect(exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith("null");
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/api/v1/records/get");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      baseId: "bse_1",
      fieldSlug: "slug",
      valueText: "missing value",
    });
  });

  it("uses a rotated OAuth access token for the command that triggered auto-refresh", async () => {
    const configDir = join(suiteHome, ".busabase");
    const configPath = join(configDir, ".env");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      configPath,
      `BUSABASE_BASE_URL=https://busabase.com\nBUSABASE_API_KEY=bso_old\nBUSABASE_REFRESH_TOKEN=bsr_old\nBUSABASE_TOKEN_EXPIRES_AT=${new Date(Date.now() + 60_000).toISOString()}\n`,
    );
    const apiAuthorizationHeaders: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.endsWith("/api/oauth/token")) {
        return jsonResponse({
          access_token: "bso_new",
          refresh_token: "bsr_new",
          expires_in: 3600,
        });
      }
      apiAuthorizationHeaders.push(request.headers.get("authorization") ?? "");
      return jsonResponse([]);
    }) as typeof fetch;
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const exitCode = await runCli(["--output", "json", "assets", "list"]);
      expect(exitCode).toBe(0);
      expect(apiAuthorizationHeaders).toEqual(["Bearer bso_new"]);
      expect(await readFile(configPath, "utf8")).toContain("BUSABASE_API_KEY=bso_new");
    } finally {
      await rm(configPath, { force: true });
    }
  });

  it("routes a generated mutation with a path param and JSON body", async () => {
    const calls: Array<{ body: unknown; channel: string | null; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await request.json() : null,
        channel: request.headers.get("x-busabase-channel"),
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "crq_9", status: "in_review" });
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "records",
      "update-change-request",
      "--record-id",
      "rec_1",
      "--fields-json",
      '{"title":"Updated"}',
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        channel: "cli",
        url: "http://localhost:15419/api/v1/records/rec_1/change-requests",
        body: { operation: "update", fields: { title: "Updated" } },
      }),
    ]);
  });

  describe("--playbook attribution", () => {
    const originalPlaybookEnv = process.env.BUSABASE_PLAYBOOK;
    afterEach(() => {
      if (originalPlaybookEnv === undefined) delete process.env.BUSABASE_PLAYBOOK;
      else process.env.BUSABASE_PLAYBOOK = originalPlaybookEnv;
    });

    const captureHeaders = () => {
      const seen: Array<{ method: string; playbook: string | null }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        seen.push({
          method: request.method,
          playbook: request.headers.get("x-busabase-playbook"),
        });
        return jsonResponse({ id: "crq_9", status: "in_review" });
      }) as typeof fetch;
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      return seen;
    };

    const writeArgs = [
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "records",
      "update-change-request",
      "--record-id",
      "rec_1",
      "--fields-json",
      '{"title":"Updated"}',
    ];

    it("puts the playbook header on a write request", async () => {
      delete process.env.BUSABASE_PLAYBOOK;
      const seen = captureHeaders();
      const exitCode = await runCli([...writeArgs, "--playbook", "prompt:nod_123:log-visit"]);
      expect(exitCode).toBe(0);
      expect(seen).toEqual([{ method: "POST", playbook: "prompt:nod_123:log-visit" }]);
    });

    it("sends no playbook header without the flag or env", async () => {
      delete process.env.BUSABASE_PLAYBOOK;
      const seen = captureHeaders();
      expect(await runCli(writeArgs)).toBe(0);
      expect(seen).toEqual([{ method: "POST", playbook: null }]);
    });

    it("falls back to BUSABASE_PLAYBOOK, and the flag wins over it", async () => {
      process.env.BUSABASE_PLAYBOOK = "skill:nod_env";
      const seen = captureHeaders();
      expect(await runCli(writeArgs)).toBe(0);
      expect(await runCli([...writeArgs, "--playbook", "skill:nod_flag"])).toBe(0);
      expect(seen.map((s) => s.playbook)).toEqual(["skill:nod_env", "skill:nod_flag"]);
    });

    it("sends the header on raw requests (`api` passthrough) too", async () => {
      delete process.env.BUSABASE_PLAYBOOK;
      const seen = captureHeaders();
      const exitCode = await runCli([
        "--base-url",
        "http://localhost:15419",
        "--playbook",
        "skill:nod_raw",
        "api",
        "--method",
        "post",
        "--path",
        "/records/rec_1/change-requests",
        "--body-json",
        '{"operation":"update","fields":{"title":"x"}}',
      ]);
      expect(exitCode).toBe(0);
      expect(seen).toEqual([{ method: "POST", playbook: "skill:nod_raw" }]);
    });

    it("rejects a malformed --playbook as a usage error before any request", async () => {
      delete process.env.BUSABASE_PLAYBOOK;
      global.fetch = vi.fn() as typeof fetch;
      const stderr: string[] = [];
      vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
        stderr.push(String(chunk));
        return true;
      });
      // A prompt needs its key; a skill must not have one.
      for (const bad of ["prompt:nod_1", "skill:nod_1:key", "recipe:nod_1"]) {
        expect(await runCli([...writeArgs, "--playbook", bad])).toBe(EXIT_CODES.USAGE);
      }
      expect(global.fetch).not.toHaveBeenCalled();
      expect(stderr.join("")).toContain("prompt:<nodeId>:<key>");
    });

    it("rejects a malformed BUSABASE_PLAYBOOK as a usage error before any request", async () => {
      process.env.BUSABASE_PLAYBOOK = "prompt:nod_1";
      global.fetch = vi.fn() as typeof fetch;
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(await runCli(writeArgs)).toBe(EXIT_CODES.USAGE);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(error.mock.calls.join("\n")).toContain('Invalid BUSABASE_PLAYBOOK "prompt:nod_1"');
    });
  });

  it("routes generated Asset metadata updates through the public Assets API", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await request.json() : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ asset: { id: "ast_1", metadata: {} }, usages: [] });
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "assets",
      "update-metadata",
      "--asset-id",
      "ast_1",
      "--metadata-json",
      '{"summary":"AI-readable PDF summary","tags":["insurance"]}',
      "--mode",
      "replace",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        method: "PATCH",
        url: "http://localhost:15419/api/v1/assets/ast_1/metadata",
        body: {
          metadata: { summary: "AI-readable PDF summary", tags: ["insurance"] },
          mode: "replace",
        },
      }),
    ]);
  });

  it("routes generated assets edit-content through the public Assets API (--edits-json array field)", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await request.json() : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "crq_1", status: "in_review" });
    }) as typeof fetch;

    const edits = [{ oldString: "ACME Corp", newString: "Umbrella Inc" }];
    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "assets",
      "edit-content",
      "--asset-id",
      "ast_1",
      "--edits-json",
      JSON.stringify(edits),
      "--message",
      "Rename ACME to Umbrella",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/assets/ast_1/edit-content",
        body: { edits, message: "Rename ACME to Umbrella" },
      }),
    ]);
  });

  it("routes a generated command with a discriminated-union input via --input-json", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await request.json() : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "whk_1" });
    }) as typeof fetch;

    const payload = {
      name: "notify on new posts",
      eventType: "record.created",
      baseId: null,
      actionKind: "webhook",
      config: { targetUrl: "https://example.com/hook" },
      enabled: true,
    };
    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "webhooks",
      "create",
      "--input-json",
      JSON.stringify(payload),
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/webhooks",
        body: payload,
      }),
    ]);
  });

  it("routes a generated path-only mutation (webhooks test-fire) with no request body", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await requestBody(request) : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "whd_1", ruleId: "whk_1", status: "success" });
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "webhooks",
      "test-fire",
      "--id",
      "whk_1",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/webhooks/whk_1/test-fire",
      }),
    ]);
  });

  it("routes generated webhooks get/delete GET/DELETE commands with the id path param", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({ method: request.method, url: request.url });
      return jsonResponse({ id: "whk_1", success: true });
    }) as typeof fetch;

    await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "webhooks",
      "get",
      "--id",
      "whk_1",
    ]);
    await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "webhooks",
      "delete",
      "--id",
      "whk_1",
    ]);

    expect(calls).toEqual([
      { method: "GET", url: "http://localhost:15419/api/v1/webhooks/whk_1" },
      { method: "DELETE", url: "http://localhost:15419/api/v1/webhooks/whk_1" },
    ]);
  });

  it("routes generated webhooks update (--input-json) through PUT with the id path param", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await request.json() : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "whk_1" });
    }) as typeof fetch;

    const payload = {
      id: "whk_1",
      name: "renamed",
      eventType: "record.created",
      baseId: null,
      actionKind: "webhook",
      config: { targetUrl: "https://example.com/hook" },
      enabled: false,
    };
    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "webhooks",
      "update",
      "--input-json",
      JSON.stringify(payload),
    ]);

    expect(exitCode).toBe(0);
    // `id` is both the path param and part of the JSON body — the oRPC client
    // extracts it for the URL and still leaves it in the payload it sends.
    expect(calls).toEqual([
      expect.objectContaining({
        method: "PUT",
        url: "http://localhost:15419/api/v1/webhooks/whk_1",
      }),
    ]);
  });

  it("routes generated webhooks deliveries with a path param plus a numeric query flag", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({ method: request.method, url: request.url });
      return jsonResponse([]);
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "webhooks",
      "deliveries",
      "--rule-id",
      "whk_1",
      "--limit",
      "5",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        method: "GET",
        url: "http://localhost:15419/api/v1/webhooks/whk_1/deliveries?limit=5",
      },
    ]);
  });

  it("creates a folder node Change Request through the node endpoint", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await requestBody(request) : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "crq_1", status: "in_review" });
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "nodes",
      "create-change-request",
      "--type",
      "folder",
      "--slug",
      "crm",
      "--name",
      "CRM",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/nodes/change-requests",
        body: {
          message: "Create folder CRM",
          operations: [{ kind: "create", name: "CRM", nodeType: "folder", slug: "crm" }],
        },
      }),
    ]);
  });

  it("prints nodes list as a terminal-friendly tree by default", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    global.fetch = vi.fn(async () =>
      jsonResponse([
        {
          id: "nod_root",
          parentId: null,
          type: "folder",
          slug: "workspace",
          name: "Workspace",
          description: "",
          metadata: {},
          position: 0,
          createdAt: "2026-07-07T00:00:00.000Z",
          updatedAt: "2026-07-07T00:00:00.000Z",
          baseId: null,
          children: [
            {
              id: "nod_blog",
              parentId: "nod_root",
              type: "base",
              slug: "blog",
              name: "Blog Posts",
              description: "",
              metadata: {},
              position: 0,
              createdAt: "2026-07-07T00:00:00.000Z",
              updatedAt: "2026-07-07T00:00:00.000Z",
              baseId: "bse_blog",
              children: [],
            },
          ],
        },
      ]),
    ) as typeof fetch;

    const exitCode = await runCli(["--base-url", "http://localhost:15419", "nodes", "list"]);

    expect(exitCode).toBe(0);
    const output = log.mock.calls.at(-1)?.[0] as string;
    expect(output).toContain("[folder] Workspace /workspace");
    expect(output).toContain("└─ [base] Blog Posts /blog");
    expect(output).not.toContain('"children"');
  });

  it("creates rich Bases from fields JSON", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await requestBody(request) : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "bse_1", slug: "products" });
    }) as typeof fetch;

    const fields = JSON.stringify([
      { slug: "product_name", name: "产品名称 Product Name", type: "text", required: true },
      {
        slug: "status",
        name: "状态 Status",
        type: "select",
        options: { choices: [{ id: "live", name: "Live", color: "emerald" }] },
      },
    ]);

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "bases",
      "create",
      "--slug",
      "products",
      "--name",
      "产品目录 Products",
      "--fields-json",
      fields,
      "--parent-node-id",
      "nod_product",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/bases",
        body: {
          fields: JSON.parse(fields),
          name: "产品目录 Products",
          parentNodeId: "nod_product",
          slug: "products",
        },
      }),
    ]);
  });

  it("creates base node Change Requests from fields JSON", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await requestBody(request) : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "crq_1", status: "in_review" });
    }) as typeof fetch;

    const fields = JSON.stringify([
      { slug: "slug", name: "Slug", type: "text", unique: true },
      {
        slug: "category",
        name: "Category",
        type: "select",
        options: { choices: [{ id: "blog", name: "Blog", color: "blue" }] },
      },
    ]);

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "nodes",
      "create-change-request",
      "--type",
      "base",
      "--slug",
      "content",
      "--name",
      "内容 Content",
      "--fields-json",
      fields,
    ]);

    expect(exitCode).toBe(0);
    // Dispatched to the Base endpoint rather than the generic tree endpoint:
    // `POST /bases` is the only one that accepts inline field definitions.
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/bases",
        body: {
          fields: JSON.parse(fields),
          name: "内容 Content",
          slug: "content",
        },
      }),
    ]);
  });

  it("creates FileNode Change Requests with Asset metadata", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await requestBody(request) : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "crq_1", status: "in_review" });
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "nodes",
      "create-change-request",
      "--type",
      "file",
      "--slug",
      "board-plan",
      "--name",
      "Board Plan",
      "--description",
      "Planning PDF",
      "--parent-node-id",
      "nod_parent",
      "--asset-id",
      "ast_1",
    ]);

    expect(exitCode).toBe(0);
    // Dispatched to `POST /files`, which takes `assetId` as a first-class field
    // instead of smuggling it through the generic operation's `metadata` bag.
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/files",
        body: {
          assetId: "ast_1",
          description: "Planning PDF",
          name: "Board Plan",
          parentNodeId: "nod_parent",
          slug: "board-plan",
        },
      }),
    ]);
  });

  it("rejects FileNode Change Requests without an Asset id before fetching", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    global.fetch = vi.fn() as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "nodes",
      "create-change-request",
      "--type",
      "file",
      "--slug",
      "board-plan",
      "--name",
      "Board Plan",
    ]);

    expect(exitCode).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(error.mock.calls.join("\n")).toContain('assetId is required for type "file"');
  });

  it("rejects mixed shorthand and JSON field definitions", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    global.fetch = vi.fn() as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "bases",
      "create",
      "--slug",
      "products",
      "--name",
      "Products",
      "--field",
      "name:Name:text",
      "--fields-json",
      "[]",
    ]);

    expect(exitCode).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(error.mock.calls.join("\n")).toContain("Pass either --field or --fields-json");
  });

  it("dispatches airapp creation to the AirApp endpoint, not the generic node endpoint", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await requestBody(request) : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "crq_1", status: "in_review" });
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "nodes",
      "create-change-request",
      "--type",
      "airapp",
      "--slug",
      "hello-app",
      "--name",
      "Hello App",
    ]);

    expect(exitCode).toBe(0);
    // Dispatched to `POST /file-trees` with `type: "airapp"`. The generic tree
    // endpoint would also accept `nodeType: "airapp"`, but it has no `files`
    // field — so it produces an AirApp with none of the default scaffold, which
    // is not a usable AirApp.
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/file-trees",
        body: { type: "airapp", name: "Hello App", slug: "hello-app" },
      }),
    ]);
  });

  it("passes --app-version through instead of colliding with the CLI's own --version", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await requestBody(request) : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "crq_1", status: "in_review" });
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "nodes",
      "create-change-request",
      "--type",
      "airapp",
      "--slug",
      "hello-app",
      "--name",
      "Hello App",
      "--app-version",
      "0.4.0",
    ]);

    // A bare `--version` flag on this command previously collided with the
    // root CLI's own `-v, --version` — commander printed the CLI's package
    // version and exited 0 without ever reaching the AirApp create request.
    // `--app-version` must reach the request body untouched.
    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/file-trees",
        body: { type: "airapp", name: "Hello App", slug: "hello-app", version: "0.4.0" },
      }),
    ]);
  });

  it("lists AirApps through the unified node list, keeping the `airapps list` name", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({ method: request.method, url: request.url });
      return jsonResponse([]);
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "airapps",
      "list",
    ]);

    expect(exitCode).toBe(0);
    // `GET /file-trees` is retired; one filtered call to the unified node list
    // replaces it. The command name users already type is unchanged.
    expect(calls).toEqual([
      { method: "GET", url: "http://localhost:15419/api/v1/nodes?types%5B0%5D=airapp" },
    ]);
  });

  it("gets one AirApp by node id through the unified node detail route", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({ method: request.method, url: request.url });
      return jsonResponse({
        type: "airapp",
        node: { id: "nod_1" },
        entryFile: "package.json",
        visibility: "private",
        version: "0.1.0",
        files: [],
      });
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "airapps",
      "get",
      "--node-id",
      "nod_1",
    ]);

    expect(exitCode).toBe(0);
    // `GET /file-trees/{nodeId}` is retired. `type` is now a disambiguation hint
    // for a slug rather than a route selector, and the payload comes back under
    // the `airapp` branch of the discriminated NodeDetailVO.
    expect(calls).toEqual([
      { method: "GET", url: "http://localhost:15419/api/v1/nodes/nod_1?type=airapp" },
    ]);
  });

  it("creates an AirApp from inline files JSON (review-first, no autoMerge)", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await requestBody(request) : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "crq_1", status: "in_review" });
    }) as typeof fetch;

    const files = JSON.stringify([{ path: "index.js", content: "console.log('hi')" }]);

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "airapps",
      "create",
      "--slug",
      "hello-app",
      "--name",
      "Hello App",
      "--files-json",
      files,
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/file-trees",
        body: {
          type: "airapp",
          slug: "hello-app",
          name: "Hello App",
          files: JSON.parse(files),
        },
      }),
    ]);
  });

  it("creates an AirApp immediately with --auto-merge", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await requestBody(request) : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({
        node: { id: "nod_1" },
        entryFile: "package.json",
        visibility: "private",
        version: "0.1.0",
        files: [],
      });
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "airapps",
      "create",
      "--slug",
      "hello-app",
      "--name",
      "Hello App",
      "--auto-merge",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/file-trees",
        body: {
          type: "airapp",
          slug: "hello-app",
          name: "Hello App",
          autoMerge: true,
        },
      }),
    ]);
  });

  it("terminally closes a Change Request through the close endpoint", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await requestBody(request) : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "crq_1", status: "rejected" });
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "change-requests",
      "close",
      "--change-request-id",
      "crq_1",
      "--reason",
      "Wrong proposal",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/change-requests/crq_1/close",
        body: { reason: "Wrong proposal" },
      }),
    ]);
  });

  it("pushes the affected-node filter through the generated Change Request list command", async () => {
    const calls: Request[] = [];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push(request);
      return jsonResponse({ changeRequests: [], nextCursor: null });
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "change-requests",
      "list",
      "--affects-node-id",
      "nod_target",
      "--status-json",
      '["in_review","approved","conflict"]',
      "--limit",
      "1",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/api/v1/change-requests");
    expect(url.searchParams.get("affectsNodeId")).toBe("nod_target");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(
      [...url.searchParams.entries()]
        .filter(([key]) => key.startsWith("status["))
        .map(([, value]) => value),
    ).toEqual(["in_review", "approved", "conflict"]);
  });

  it("lists records with base and cursor filters (one always-paginated endpoint)", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await requestBody(request) : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ records: [{ id: "rec_1" }], nextCursor: "cur_2" });
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "records",
      "query",
      "--base-id",
      "bse_1",
      "--limit",
      "100",
      "--cursor",
      "cur_1",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        body: null,
        method: "GET",
        url: "http://localhost:15419/api/v1/records?limit=100&baseId=bse_1&cursor=cur_1",
      }),
    ]);
    expect(JSON.parse(log.mock.calls.at(-1)?.[0] as string)).toEqual({
      records: [{ id: "rec_1" }],
      nextCursor: "cur_2",
    });
  });

  it("rejects record list limits above the server maximum before fetching", async () => {
    global.fetch = vi.fn() as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "records",
      "query",
      "--limit",
      "101",
    ]);

    expect(exitCode).toBe(EXIT_CODES.USAGE);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("uploads assets and prints an asset-backed record-field ref", async () => {
    const dir = await mkdtemp(join(tmpdir(), "busabase-cli-"));
    const file = join(dir, "cover.svg");
    await writeFile(file, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const calls: Array<{
      body: unknown;
      channel: string | null;
      method: string;
      url: string;
    }> = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await requestBody(request) : null,
        channel: request.headers.get("x-busabase-channel"),
        method: request.method,
        url: request.url,
      });
      if (request.method === "PUT") return new Response(null, { status: 200 });
      if (request.url.endsWith("/api/v1/assets/upload-urls")) {
        return jsonResponse({
          duplicate: false,
          publicUrl: "https://cdn.example/cover.svg",
          storageKey: "attachments/cover.svg",
          uploadUrl: "https://upload.example/cover.svg",
        });
      }
      return jsonResponse({
        assetId: "ast_1",
        attachmentId: "att_1",
        publicUrl: "https://cdn.example/cover.svg",
        storageKey: "attachments/cover.svg",
      });
    }) as typeof fetch;

    try {
      const exitCode = await runCli([
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
        "assets",
        "upload",
        "--file",
        file,
        "--context",
        "record-field",
      ]);

      expect(exitCode).toBe(0);
      expect(calls.map((call) => [call.method, call.url])).toEqual([
        ["POST", "http://localhost:15419/api/v1/assets/upload-urls"],
        ["PUT", "https://upload.example/cover.svg"],
        ["POST", "http://localhost:15419/api/v1/assets/confirmations"],
      ]);
      expect(calls.map((call) => call.channel)).toEqual(["cli", null, "cli"]);
      expect(calls[0]?.body).toEqual(
        expect.objectContaining({
          context: "record-field",
          contentHash: expect.stringMatching(/^sha256:/),
          fileName: "cover.svg",
          mimeType: "image/svg+xml",
        }),
      );
      expect(JSON.parse(log.mock.calls.at(-1)?.[0] as string)).toEqual({
        assetId: "ast_1",
        attachmentId: "att_1",
        fileName: "cover.svg",
        id: "ast_1",
        mimeType: "image/svg+xml",
        size: 41,
        url: "https://cdn.example/cover.svg",
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("does not expose the old attachments upload command", async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    const exitCode = await runCli(["attachments", "upload", "--file", "cover.svg"]);

    expect(exitCode).toBe(EXIT_CODES.USAGE);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("creates field update Change Requests with attachment options", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await requestBody(request) : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse({ id: "crq_1", status: "in_review" });
    }) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "bases",
      "update-field-change-request",
      "--base-id",
      "bse_1",
      "--field-id",
      "bsf_1",
      "--max-files",
      "1",
      "--allowed-mime",
      "image/png",
      "--allowed-mime",
      "image/svg+xml",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      expect.objectContaining({
        body: {
          operation: "update",
          fieldId: "bsf_1",
          patch: {
            options: {
              attachment: {
                allowedMimeTypes: ["image/png", "image/svg+xml"],
                maxFiles: 1,
              },
            },
          },
        },
        method: "POST",
        url: "http://localhost:15419/api/v1/bases/bse_1/fields/change-requests",
      }),
    ]);
  });

  it("login --api-key verifies the key and persists creds to ~/.busabase/.env", async () => {
    // Redirect HOME so the test never touches the developer's real ~/.busabase/.env.
    const home = await mkdtemp(join(tmpdir(), "busabase-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = home;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push(`${request.method} ${request.url}`);
      expect(request.headers.get("authorization")).toBe("Bearer sk_test");
      return jsonResponse({
        user: { id: "usr_1", email: "dev@example.com" },
        space: { id: "spc_1", name: "Space One" },
        spaces: [{ id: "spc_1", name: "Space One" }],
      });
    }) as typeof fetch;

    try {
      const exitCode = await runCli([
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
        "login",
        "--api-key",
        "sk_test",
      ]);

      expect(exitCode).toBe(0);
      expect(calls).toEqual(["GET http://localhost:15419/api/v1/auth"]);
      const env = await readFile(join(home, ".busabase", ".env"), "utf8");
      expect(env).toContain("BUSABASE_API_KEY=sk_test");
      expect(env).toContain("BUSABASE_SPACE_ID=spc_1");
      expect(env).toContain("BUSABASE_BASE_URL=http://localhost:15419");
    } finally {
      process.env.HOME = originalHome;
      await rm(home, { force: true, recursive: true });
    }
  });

  it("login against an open local server just saves the connection (no auth)", async () => {
    const home = await mkdtemp(join(tmpdir(), "busabase-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = home;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push(`${request.method} ${request.url}`);
      // Open local server: /api/v1/bases returns 200 with no auth.
      return jsonResponse([]);
    }) as typeof fetch;

    try {
      const exitCode = await runCli([
        "login",
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
      ]);

      expect(exitCode).toBe(0);
      // Only the probe fires — no /api/oauth/* calls.
      expect(calls).toEqual(["GET http://localhost:15419/api/v1/bases"]);
      const env = await readFile(join(home, ".busabase", ".env"), "utf8");
      expect(env).toContain("BUSABASE_BASE_URL=http://localhost:15419");
      expect(env).not.toContain("BUSABASE_API_KEY=");
    } finally {
      process.env.HOME = originalHome;
      await rm(home, { force: true, recursive: true });
    }
  });

  it("login --refresh rotates the saved OAuth token set", async () => {
    const home = await mkdtemp(join(tmpdir(), "busabase-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = home;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await mkdir(join(home, ".busabase"), { recursive: true });
    await writeFile(
      join(home, ".busabase", ".env"),
      "BUSABASE_BASE_URL=http://localhost:15419\nBUSABASE_API_KEY=bso_old\nBUSABASE_REFRESH_TOKEN=bsr_old\nBUSABASE_TOKEN_EXPIRES_AT=2020-01-01T00:00:00.000Z\n",
    );
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push(`${request.method} ${request.url}`);
      expect(await request.clone().text()).toContain("refresh_token=bsr_old");
      return jsonResponse({ access_token: "bso_new", refresh_token: "bsr_new", expires_in: 3600 });
    }) as typeof fetch;

    try {
      const exitCode = await runCli(["login", "--refresh"]);
      expect(exitCode).toBe(0);
      expect(calls).toEqual(["POST http://localhost:15419/api/oauth/token"]);
      const env = await readFile(join(home, ".busabase", ".env"), "utf8");
      expect(env).toContain("BUSABASE_API_KEY=bso_new");
      expect(env).toContain("BUSABASE_REFRESH_TOKEN=bsr_new");
    } finally {
      process.env.HOME = originalHome;
      await rm(home, { force: true, recursive: true });
    }
  });

  it("prints the real server error message for a server-side failure, not the raw JSON blob", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    global.fetch = vi.fn(
      async () => new Response('{"error":"storage missing"}', { status: 500 }),
    ) as typeof fetch;

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "api",
      "--method",
      "get",
      "--path",
      "/records",
    ]);

    expect(exitCode).toBe(EXIT_CODES.SERVER_ERROR);
    // `api` goes through rawFetch (outside the typed contract) — its
    // `formatRawErrorBody` extracts the server's `error` field instead of
    // dumping the raw `{"error":"..."}` JSON verbatim.
    expect(error.mock.calls.join("\n")).toContain("HTTP 500 : storage missing");
  });

  // ── Drive Grep Retrieval: assets put-text / grep / read-lines ────────────────
  // The underlying router/logic is already covered in packages/busabase-core; these
  // tests exercise only the CLI's own wiring: flag parsing, the inline-vs-presigned
  // size branch in putTextCommand, and error surfacing. Request/response shapes below
  // (e.g. assetId living in the URL path, not the JSON body) were confirmed against
  // the real oRPC client before writing these assertions, not assumed.
  describe("assets put-text / grep / read-lines (Drive Grep Retrieval)", () => {
    it("writes inline text via put-text --text", async () => {
      const calls: Array<{ body: unknown; method: string; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({
          body: request.body ? await requestBody(request) : null,
          method: request.method,
          url: request.url,
        });
        return jsonResponse({
          assetId: "ast_1",
          textStatus: "present",
          lineCount: 1,
          charCount: 12,
          byteCount: 12,
        });
      }) as typeof fetch;

      const exitCode = await runCli([
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
        "assets",
        "put-text",
        "--asset-id",
        "ast_1",
        "--text",
        "small string",
      ]);

      expect(exitCode).toBe(0);
      // assetId is a path param on PUT /assets/{assetId}/text, not a body field.
      expect(calls).toEqual([
        expect.objectContaining({
          method: "PUT",
          url: "http://localhost:15419/api/v1/assets/ast_1/text",
          body: { text: "small string" },
        }),
      ]);
    });

    it("writes text from a large --file via the presigned upload flow (createTextUploadUrl -> PUT -> putText)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "busabase-cli-text-"));
      const file = join(dir, "large.txt");
      const largeText = "a".repeat(1024 * 1024 + 100); // exceeds the 1MB inline cap
      await writeFile(file, largeText, "utf8");
      const calls: Array<{ body: unknown; method: string; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({
          body: request.body ? await requestBody(request) : null,
          method: request.method,
          url: request.url,
        });
        if (request.url === "https://upload.example/large.txt") {
          return new Response(null, { status: 200 });
        }
        if (request.url.endsWith("/api/v1/assets/text/upload-urls")) {
          return jsonResponse({
            uploadUrl: "https://upload.example/large.txt",
            storageKey: "asset-texts/pending/large.txt",
            expiresIn: 3600,
          });
        }
        return jsonResponse({
          assetId: "ast_1",
          textStatus: "present",
          lineCount: 1,
          charCount: largeText.length,
          byteCount: largeText.length,
        });
      }) as typeof fetch;

      try {
        const exitCode = await runCli([
          "--base-url",
          "http://localhost:15419",
          "--output",
          "json",
          "assets",
          "put-text",
          "--asset-id",
          "ast_1",
          "--file",
          file,
        ]);

        expect(exitCode).toBe(0);
        expect(calls.map((call) => [call.method, call.url])).toEqual([
          ["POST", "http://localhost:15419/api/v1/assets/text/upload-urls"],
          ["PUT", "https://upload.example/large.txt"],
          ["PUT", "http://localhost:15419/api/v1/assets/ast_1/text"],
        ]);
        expect(calls[0]?.body).toEqual({ assetId: "ast_1", sizeBytes: largeText.length });
        // Middle call is a raw byte PUT (text/plain), not JSON — assert the real bytes went out.
        expect((calls[1]?.body as string)?.length).toBe(largeText.length);
        expect(calls[2]?.body).toEqual({ storageKey: "asset-texts/pending/large.txt" });
      } finally {
        await rm(dir, { force: true, recursive: true });
      }
    });

    it("marks an asset's text slot as none via put-text --none", async () => {
      const calls: Array<{ body: unknown; method: string; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({
          body: request.body ? await requestBody(request) : null,
          method: request.method,
          url: request.url,
        });
        return jsonResponse({
          assetId: "ast_1",
          textStatus: "none",
          lineCount: 0,
          charCount: 0,
          byteCount: 0,
        });
      }) as typeof fetch;

      const exitCode = await runCli([
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
        "assets",
        "put-text",
        "--asset-id",
        "ast_1",
        "--none",
      ]);

      expect(exitCode).toBe(0);
      expect(calls).toEqual([
        expect.objectContaining({
          method: "PUT",
          url: "http://localhost:15419/api/v1/assets/ast_1/text",
          body: { none: true },
        }),
      ]);
    });

    it("rejects put-text without --text, --file, or --none before making any HTTP call", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      global.fetch = vi.fn() as typeof fetch;

      const exitCode = await runCli([
        "--base-url",
        "http://localhost:15419",
        "assets",
        "put-text",
        "--asset-id",
        "ast_1",
      ]);

      expect(exitCode).toBe(1);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(error.mock.calls.join("\n")).toContain(
        "Provide --text <string>, --file <path>, or --none.",
      );
    });

    it("surfaces a clear error when the presigned text upload PUT fails (no silent failure)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "busabase-cli-text-"));
      const file = join(dir, "large.txt");
      const largeText = "b".repeat(1024 * 1024 + 100);
      await writeFile(file, largeText, "utf8");
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const calls: Array<{ method: string; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({ method: request.method, url: request.url });
        if (request.url === "https://upload.example/large.txt") {
          return new Response("disk full", { status: 500, statusText: "Internal Server Error" });
        }
        return jsonResponse({
          uploadUrl: "https://upload.example/large.txt",
          storageKey: "asset-texts/pending/large.txt",
          expiresIn: 3600,
        });
      }) as typeof fetch;

      try {
        const exitCode = await runCli([
          "--base-url",
          "http://localhost:15419",
          "assets",
          "put-text",
          "--asset-id",
          "ast_1",
          "--file",
          file,
        ]);

        expect(exitCode).toBe(1);
        // Only 2 calls: createTextUploadUrl + the failed PUT — putText is never reached.
        expect(calls.map((call) => [call.method, call.url])).toEqual([
          ["POST", "http://localhost:15419/api/v1/assets/text/upload-urls"],
          ["PUT", "https://upload.example/large.txt"],
        ]);
        expect(error.mock.calls.join("\n")).toContain(
          "Text byte upload failed (500 Internal Server Error): disk full",
        );
      } finally {
        await rm(dir, { force: true, recursive: true });
      }
    });

    it("surfaces a clear error without a trailing colon when the failed presigned PUT has an empty body", async () => {
      const dir = await mkdtemp(join(tmpdir(), "busabase-cli-text-"));
      const file = join(dir, "large.txt");
      const largeText = "e".repeat(1024 * 1024 + 100);
      await writeFile(file, largeText, "utf8");
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (request.url === "https://upload.example/large.txt") {
          return new Response(null, { status: 503, statusText: "Service Unavailable" });
        }
        return jsonResponse({
          uploadUrl: "https://upload.example/large.txt",
          storageKey: "asset-texts/pending/large.txt",
          expiresIn: 3600,
        });
      }) as typeof fetch;

      try {
        const exitCode = await runCli([
          "--base-url",
          "http://localhost:15419",
          "assets",
          "put-text",
          "--asset-id",
          "ast_1",
          "--file",
          file,
        ]);

        expect(exitCode).toBe(1);
        expect(error.mock.calls.join("\n")).toContain(
          "Text byte upload failed (503 Service Unavailable)",
        );
        expect(error.mock.calls.join("\n")).not.toMatch(/Service Unavailable\):/);
      } finally {
        await rm(dir, { force: true, recursive: true });
      }
    });

    it("searches every text-bearing asset via grep with only --pattern (no spurious scope/defaults sent)", async () => {
      const calls: Array<{ body: unknown; method: string; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({
          body: request.body ? await requestBody(request) : null,
          method: request.method,
          url: request.url,
        });
        return jsonResponse({
          matches: [],
          coverage: {
            files: {
              scanned: 0,
              missing: [],
              stale: [],
              unsearchable: 0,
              errored: [],
              notReached: 0,
            },
            docs: { scanned: 0, errored: [], notReached: 0 },
            records: { scanned: 0, errored: [], notReached: 0 },
          },
          truncated: false,
        });
      }) as typeof fetch;

      const exitCode = await runCli([
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
        "assets",
        "grep",
        "--pattern",
        "foo",
      ]);

      expect(exitCode).toBe(0);
      expect(calls).toEqual([
        expect.objectContaining({
          method: "POST",
          url: "http://localhost:15419/api/v1/grep",
          body: { pattern: "foo", sources: ["files"] },
        }),
      ]);
    });

    it("searches with a full grep scope, flags, and match options", async () => {
      const calls: Array<{ body: unknown; method: string; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({
          body: request.body ? await requestBody(request) : null,
          method: request.method,
          url: request.url,
        });
        return jsonResponse({
          matches: [],
          coverage: {
            files: {
              scanned: 0,
              missing: [],
              stale: [],
              unsearchable: 0,
              errored: [],
              notReached: 0,
            },
            docs: { scanned: 0, errored: [], notReached: 0 },
            records: { scanned: 0, errored: [], notReached: 0 },
          },
          truncated: false,
        });
      }) as typeof fetch;

      const exitCode = await runCli([
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
        "assets",
        "grep",
        "--pattern",
        "foo",
        "--flags",
        "i",
        "--asset-ids",
        "a1",
        "a2",
        "--drive-path",
        "/docs",
        "--mime-types",
        "application/pdf",
        "text/plain",
        "--max-matches",
        "50",
        "--context-lines",
        "3",
      ]);

      expect(exitCode).toBe(0);
      expect(calls).toEqual([
        expect.objectContaining({
          method: "POST",
          url: "http://localhost:15419/api/v1/grep",
          body: {
            pattern: "foo",
            flags: "i",
            sources: ["files"],
            scope: {
              files: {
                assetIds: ["a1", "a2"],
                drivePath: "/docs",
                mimeTypes: ["application/pdf", "text/plain"],
              },
            },
            maxMatches: 50,
            contextLines: 3,
          },
        }),
      ]);
    });

    it("routes the `search` command to GET /search with query/limit/offset", async () => {
      const calls: Array<{ method: string; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({ method: request.method, url: request.url });
        return jsonResponse({ results: [], hasMore: false, limit: 20, offset: 0, query: "foo" });
      }) as typeof fetch;

      const exitCode = await runCli([
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
        "search",
        "--query",
        "foo",
        "--limit",
        "20",
        "--offset",
        "0",
      ]);

      expect(exitCode).toBe(0);
      expect(calls).toEqual([
        {
          method: "GET",
          url: "http://localhost:15419/api/v1/search?query=foo&limit=20&offset=0",
        },
      ]);
    });

    it("routes the `search` command's --sources flag as repeated query params", async () => {
      const calls: Array<{ method: string; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({ method: request.method, url: request.url });
        return jsonResponse({ results: [], hasMore: false, limit: 20, offset: 0, query: "foo" });
      }) as typeof fetch;

      const exitCode = await runCli([
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
        "search",
        "--query",
        "foo",
        "--sources",
        "files",
        "records",
      ]);

      expect(exitCode).toBe(0);
      // The oRPC client serializes an array input as bracket-indexed query
      // params (sources[0]=files&sources[1]=records), not repeated keys —
      // and the server accepts both shapes (see
      // search-sources-openapi.test.ts for the repeated-key shape a human
      // would type by hand with curl).
      expect(calls).toEqual([
        {
          method: "GET",
          url: "http://localhost:15419/api/v1/search?query=foo&sources%5B0%5D=files&sources%5B1%5D=records",
        },
      ]);
    });

    it("routes the top-level `grep` command (Unified Grep) to POST /grep, not /assets/grep", async () => {
      const calls: Array<{ body: unknown; method: string; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({
          body: request.body ? await requestBody(request) : null,
          method: request.method,
          url: request.url,
        });
        return jsonResponse({
          matches: [],
          coverage: {
            files: {
              scanned: 0,
              missing: [],
              stale: [],
              unsearchable: 0,
              errored: [],
              notReached: 0,
            },
            docs: { scanned: 0, errored: [], notReached: 0 },
            records: { scanned: 0, errored: [], notReached: 0 },
          },
          truncated: false,
        });
      }) as typeof fetch;

      const exitCode = await runCli([
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
        "grep",
        "--pattern",
        "foo",
        "--sources",
        "nodes",
        "--node-ids",
        "nod_1",
        "nod_2",
      ]);

      expect(exitCode).toBe(0);
      expect(calls).toEqual([
        expect.objectContaining({
          method: "POST",
          url: "http://localhost:15419/api/v1/grep",
          body: {
            pattern: "foo",
            sources: ["nodes"],
            scope: { nodes: { nodeIds: ["nod_1", "nod_2"], types: undefined } },
          },
        }),
      ]);
    });

    it("routes `grep --sources prompts` and rejects a source the server does not have before fetching", async () => {
      const calls: Array<{ body: unknown; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({ body: request.body ? await requestBody(request) : null, url: request.url });
        return jsonResponse({
          matches: [],
          coverage: {
            files: {
              scanned: 0,
              missing: [],
              stale: [],
              unsearchable: 0,
              errored: [],
              notReached: 0,
            },
            nodes: { scanned: 0, errored: [], notReached: 0 },
            records: { scanned: 0, errored: [], notReached: 0 },
            prompts: { scanned: 2, errored: [], notReached: 0 },
          },
          truncated: false,
        });
      }) as typeof fetch;

      const ok = await runCli([
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
        "grep",
        "--pattern",
        "visit",
        "--sources",
        "prompts",
      ]);
      expect(ok).toBe(0);
      expect(calls).toEqual([
        {
          url: "http://localhost:15419/api/v1/grep",
          body: { pattern: "visit", sources: ["prompts"] },
        },
      ]);

      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const bad = await runCli([
        "--base-url",
        "http://localhost:15419",
        "grep",
        "--pattern",
        "visit",
        "--sources",
        "docs",
      ]);
      expect(bad).toBe(EXIT_CODES.USAGE);
      expect(calls).toHaveLength(1);
    });

    it("routes the top-level `grep` command's records scope (--base-ids/--base-slugs) and 'records' source", async () => {
      const calls: Array<{ body: unknown; method: string; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({
          body: request.body ? await requestBody(request) : null,
          method: request.method,
          url: request.url,
        });
        return jsonResponse({
          matches: [],
          coverage: {
            files: {
              scanned: 0,
              missing: [],
              stale: [],
              unsearchable: 0,
              errored: [],
              notReached: 0,
            },
            docs: { scanned: 0, errored: [], notReached: 0 },
            records: { scanned: 0, errored: [], notReached: 0 },
          },
          truncated: false,
        });
      }) as typeof fetch;

      const exitCode = await runCli([
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
        "grep",
        "--pattern",
        "ACME",
        "--sources",
        "records",
        "--base-ids",
        "qbs_1",
        "--base-slugs",
        "contracts",
      ]);

      expect(exitCode).toBe(0);
      expect(calls).toEqual([
        expect.objectContaining({
          method: "POST",
          url: "http://localhost:15419/api/v1/grep",
          body: {
            pattern: "ACME",
            sources: ["records"],
            scope: { records: { baseIds: ["qbs_1"], baseSlugs: ["contracts"] } },
          },
        }),
      ]);
    });

    it("routes the top-level `grep` command's files scope (--asset-ids/--drive-path/--mime-types) and match options (--flags/--max-matches/--context-lines)", async () => {
      const calls: Array<{ body: unknown; method: string; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({
          body: request.body ? await requestBody(request) : null,
          method: request.method,
          url: request.url,
        });
        return jsonResponse({
          matches: [],
          coverage: {
            files: {
              scanned: 0,
              missing: [],
              stale: [],
              unsearchable: 0,
              errored: [],
              notReached: 0,
            },
            docs: { scanned: 0, errored: [], notReached: 0 },
            records: { scanned: 0, errored: [], notReached: 0 },
          },
          truncated: false,
        });
      }) as typeof fetch;

      const exitCode = await runCli([
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
        "grep",
        "--pattern",
        "Termination",
        "--flags",
        "i",
        "--sources",
        "files",
        "--asset-ids",
        "ast_1",
        "ast_2",
        "--drive-path",
        "contracts/",
        "--mime-types",
        "application/pdf",
        "--max-matches",
        "50",
        "--context-lines",
        "2",
      ]);

      expect(exitCode).toBe(0);
      expect(calls).toEqual([
        expect.objectContaining({
          method: "POST",
          url: "http://localhost:15419/api/v1/grep",
          body: {
            pattern: "Termination",
            flags: "i",
            sources: ["files"],
            scope: {
              files: {
                assetIds: ["ast_1", "ast_2"],
                drivePath: "contracts/",
                mimeTypes: ["application/pdf"],
              },
            },
            maxMatches: 50,
            contextLines: 2,
          },
        }),
      ]);
    });

    it("reads an exact line range via read-lines, as GET query params", async () => {
      const calls: Array<{ method: string; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({ method: request.method, url: request.url });
        return jsonResponse({
          lines: ["a", "b"],
          startLine: 10,
          endLine: 20,
          totalLines: 100,
          truncated: false,
        });
      }) as typeof fetch;

      const exitCode = await runCli([
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
        "assets",
        "read-lines",
        "--asset-id",
        "ast_1",
        "--start-line",
        "10",
        "--end-line",
        "20",
      ]);

      expect(exitCode).toBe(0);
      expect(calls).toEqual([
        {
          method: "GET",
          url: "http://localhost:15419/api/v1/assets/ast_1/text/lines?startLine=10&endLine=20",
        },
      ]);
    });
  });

  // The Doc-domain equivalent of `assets read-lines` above — an agent's
  // follow-up after a Unified Grep match lands inside a Doc (`source:
  // "nodes"`). Every `nodes *` command (including this one) is
  // auto-generated straight from the OpenAPI contract (see
  // `registerGeneratedCommands`), so this test is the routing regression
  // guard: a contract/router typo here would have nothing else to catch it.
  describe("nodes read-lines (generated command)", () => {
    it("reads an exact line range via read-lines, as GET query params", async () => {
      const calls: Array<{ method: string; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({ method: request.method, url: request.url });
        return jsonResponse({
          lines: ["a", "b"],
          startLine: 10,
          endLine: 20,
          totalLines: 100,
          truncated: false,
        });
      }) as typeof fetch;

      const exitCode = await runCli([
        "--base-url",
        "http://localhost:15419",
        "--output",
        "json",
        "nodes",
        "read-lines",
        "--node-id",
        "nod_1",
        "--start-line",
        "10",
        "--end-line",
        "20",
      ]);

      expect(exitCode).toBe(0);
      expect(calls).toEqual([
        {
          method: "GET",
          url: "http://localhost:15419/api/v1/nodes/nod_1/lines?startLine=10&endLine=20",
        },
      ]);
    });
  });

  // Feature 3 (node-agent-prompts-v2.md §7.4) — the CLI write path for a node's
  // custom scenario prompts. Client-side schema validation must reject a
  // malformed file BEFORE any network request; only a valid array reaches
  // `nodes.updateMetadata`, and it is stored under the `agentPrompts` key
  // untransformed.
  describe("nodes set-agent-prompts", () => {
    const validPrompts = [
      {
        key: "weekly-severity-summary",
        intent: "read-only",
        label: { en: "Weekly severity summary", "zh-CN": "本周按严重程度汇总" },
        body: {
          en: "Summarize tickets opened in {target} in the last 7 days, grouped by severity.",
          "zh-CN": "汇总 {target} 最近 7 天新建的工单，按严重程度分组。",
        },
      },
      {
        key: "draft-response",
        label: "Draft a response to the selected ticket",
        body: "Draft a reply to the ticket currently selected in {target}, matching our support tone.",
      },
    ];

    it("validates and writes a well-formed file via nodes.updateAgentPrompts", async () => {
      const dir = await mkdtemp(join(tmpdir(), "busabase-cli-agent-prompts-"));
      const file = join(dir, "prompts.json");
      await writeFile(file, JSON.stringify(validPrompts));
      const calls: Array<{ body: unknown; method: string; url: string }> = [];
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({
          body: request.body ? await requestBody(request) : null,
          method: request.method,
          url: request.url,
        });
        return jsonResponse({ nodeId: "nod_1", agentPrompts: validPrompts });
      }) as typeof fetch;

      try {
        const exitCode = await runCli([
          "--base-url",
          "http://localhost:15419",
          "--output",
          "json",
          "nodes",
          "set-agent-prompts",
          "--node-id",
          "nod_1",
          "--file",
          file,
        ]);

        expect(exitCode).toBe(0);
        expect(calls).toEqual([
          expect.objectContaining({
            body: { agentPrompts: validPrompts },
            method: "PUT",
            url: "http://localhost:15419/api/v1/nodes/nod_1/agent-prompts",
          }),
        ]);
        expect(JSON.parse(log.mock.calls.at(-1)?.[0] as string)).toEqual({
          nodeId: "nod_1",
          agentPrompts: validPrompts,
        });
      } finally {
        await rm(dir, { force: true, recursive: true });
      }
    });

    it("rejects duplicate keys before making any network request", async () => {
      const dir = await mkdtemp(join(tmpdir(), "busabase-cli-agent-prompts-"));
      const file = join(dir, "prompts.json");
      await writeFile(
        file,
        JSON.stringify([
          { key: "dup", label: "One", body: "Body one about {target}" },
          { key: "dup", label: "Two", body: "Body two about {target}" },
        ]),
      );
      global.fetch = vi.fn() as typeof fetch;

      try {
        const exitCode = await runCli([
          "--base-url",
          "http://localhost:15419",
          "nodes",
          "set-agent-prompts",
          "--node-id",
          "nod_1",
          "--file",
          file,
        ]);

        expect(exitCode).toBe(EXIT_CODES.VALIDATION);
        expect(global.fetch).not.toHaveBeenCalled();
      } finally {
        await rm(dir, { force: true, recursive: true });
      }
    });

    it("rejects a label over the character limit before making any network request", async () => {
      const dir = await mkdtemp(join(tmpdir(), "busabase-cli-agent-prompts-"));
      const file = join(dir, "prompts.json");
      await writeFile(
        file,
        JSON.stringify([{ key: "too-long", label: "x".repeat(81), body: "Body about {target}" }]),
      );
      global.fetch = vi.fn() as typeof fetch;

      try {
        const exitCode = await runCli([
          "--base-url",
          "http://localhost:15419",
          "nodes",
          "set-agent-prompts",
          "--node-id",
          "nod_1",
          "--file",
          file,
        ]);

        expect(exitCode).toBe(EXIT_CODES.VALIDATION);
        expect(global.fetch).not.toHaveBeenCalled();
      } finally {
        await rm(dir, { force: true, recursive: true });
      }
    });

    it("rejects an invalid locale key before making any network request", async () => {
      const dir = await mkdtemp(join(tmpdir(), "busabase-cli-agent-prompts-"));
      const file = join(dir, "prompts.json");
      await writeFile(
        file,
        JSON.stringify([
          { key: "bad-locale", label: { xx: "Not a real locale" }, body: "Body about {target}" },
        ]),
      );
      global.fetch = vi.fn() as typeof fetch;

      try {
        const exitCode = await runCli([
          "--base-url",
          "http://localhost:15419",
          "nodes",
          "set-agent-prompts",
          "--node-id",
          "nod_1",
          "--file",
          file,
        ]);

        expect(exitCode).toBe(EXIT_CODES.VALIDATION);
        expect(global.fetch).not.toHaveBeenCalled();
      } finally {
        await rm(dir, { force: true, recursive: true });
      }
    });

    it("rejects a file that isn't valid JSON before making any network request", async () => {
      const dir = await mkdtemp(join(tmpdir(), "busabase-cli-agent-prompts-"));
      const file = join(dir, "prompts.json");
      await writeFile(file, "{ not valid json");
      global.fetch = vi.fn() as typeof fetch;

      try {
        const exitCode = await runCli([
          "--base-url",
          "http://localhost:15419",
          "nodes",
          "set-agent-prompts",
          "--node-id",
          "nod_1",
          "--file",
          file,
        ]);

        expect(exitCode).toBe(EXIT_CODES.VALIDATION);
        expect(global.fetch).not.toHaveBeenCalled();
      } finally {
        await rm(dir, { force: true, recursive: true });
      }
    });

    it("rejects more than 50 prompts before making any network request", async () => {
      const dir = await mkdtemp(join(tmpdir(), "busabase-cli-agent-prompts-"));
      const file = join(dir, "prompts.json");
      const tooMany = Array.from({ length: 51 }, (_, i) => ({
        key: `prompt-${i}`,
        label: "Label",
        body: "Body about {target}",
      }));
      await writeFile(file, JSON.stringify(tooMany));
      global.fetch = vi.fn() as typeof fetch;

      try {
        const exitCode = await runCli([
          "--base-url",
          "http://localhost:15419",
          "nodes",
          "set-agent-prompts",
          "--node-id",
          "nod_1",
          "--file",
          file,
        ]);

        expect(exitCode).toBe(EXIT_CODES.VALIDATION);
        expect(global.fetch).not.toHaveBeenCalled();
      } finally {
        await rm(dir, { force: true, recursive: true });
      }
    });

    it("accepts an empty array (clears custom prompts back to the type default)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "busabase-cli-agent-prompts-"));
      const file = join(dir, "prompts.json");
      await writeFile(file, "[]");
      const calls: Array<{ body: unknown; method: string; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({
          body: request.body ? await requestBody(request) : null,
          method: request.method,
          url: request.url,
        });
        return jsonResponse({ nodeId: "nod_1", agentPrompts: [] });
      }) as typeof fetch;

      try {
        const exitCode = await runCli([
          "--base-url",
          "http://localhost:15419",
          "nodes",
          "set-agent-prompts",
          "--node-id",
          "nod_1",
          "--file",
          file,
        ]);

        expect(exitCode).toBe(0);
        expect(calls).toEqual([expect.objectContaining({ body: { agentPrompts: [] } })]);
      } finally {
        await rm(dir, { force: true, recursive: true });
      }
    });

    /**
     * The `agent_prompts` column is the only place the server reads these from,
     * so a 404 has to surface rather than be papered over.
     *
     * This used to fall back to `PATCH /nodes/{id}/metadata`, for servers that
     * predated the endpoint. That is gone: the migration adding the column also
     * backfilled every existing `metadata.agentPrompts` array, so such a server
     * recovers its prompts on upgrade — whereas a 404 from any other cause used
     * to park the list under a key nothing reads and still exit 0.
     */
    it("fails instead of writing to metadata when the server has no agent-prompts route", async () => {
      const dir = await mkdtemp(join(tmpdir(), "busabase-cli-agent-prompts-"));
      const file = join(dir, "prompts.json");
      await writeFile(file, JSON.stringify(validPrompts));
      const calls: Array<{ body: unknown; method: string; url: string }> = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({
          body: request.body ? await requestBody(request) : null,
          method: request.method,
          url: request.url,
        });
        // An older server has no such route and answers 404.
        if (request.url.endsWith("/agent-prompts")) {
          return new Response(JSON.stringify({ message: "Not found" }), {
            headers: { "content-type": "application/json" },
            status: 404,
          });
        }
        return jsonResponse({ id: "nod_1", metadata: { agentPrompts: validPrompts } });
      }) as typeof fetch;

      try {
        const exitCode = await runCli([
          "--base-url",
          "http://localhost:15419",
          "nodes",
          "set-agent-prompts",
          "--node-id",
          "nod_1",
          "--file",
          file,
        ]);

        expect(exitCode).not.toBe(0);
        // The one write it is allowed to attempt — and no metadata PATCH behind it.
        expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
          "PUT /api/v1/nodes/nod_1/agent-prompts",
        ]);
        expect(calls.some((call) => new URL(call.url).pathname.endsWith("/metadata"))).toBe(false);
      } finally {
        await rm(dir, { force: true, recursive: true });
      }
    });
  });
});

// ── playbooks search / get (agent-playbook-discovery.md §6.6, CLI C1/C2) ──────
describe("playbooks", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const captureStdout = () => {
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.map(String).join(" "));
    });
    return () => out.join("\n");
  };

  it("C1: sends every --query and the ranking flags to POST /playbooks/search and prints the result", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    const serverResult = {
      items: [
        {
          kind: "prompt",
          nodeId: "nod_visits",
          nodeType: "base",
          nodeName: "Visits",
          nodeSlug: "visits",
          path: ["Sales"],
          key: "log-visit",
          label: "Log a customer visit",
          intent: "change",
          matchedOn: ["label"],
          score: 6,
          updatedAt: "2026-09-25T00:00:00.000Z",
        },
      ],
      total: 1,
      truncated: false,
      coverage: { skillsScanned: 2, promptNodesScanned: 1 },
    };
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await requestBody(request) : null,
        method: request.method,
        url: request.url,
      });
      return jsonResponse(serverResult);
    }) as typeof fetch;
    const stdout = captureStdout();

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "playbooks",
      "search",
      "--query",
      "记录客户拜访",
      "--query",
      "log customer visit",
      "--kinds",
      "prompt",
      "skill",
      "--near-node-id",
      "nod_pipeline",
      "--limit",
      "5",
      "--locale",
      "zh-CN",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        method: "POST",
        url: "http://localhost:15419/api/v1/playbooks/search",
        body: {
          queries: ["记录客户拜访", "log customer visit"],
          kinds: ["prompt", "skill"],
          nearNodeId: "nod_pipeline",
          limit: 5,
          locale: "zh-CN",
        },
      },
    ]);
    expect(JSON.parse(stdout())).toEqual(serverResult);
  });

  it("C2: against a server without the route (404) it falls back to skills-only and says prompts were not searched", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      calls.push(`${request.method} ${url.pathname}${url.search}`);
      if (url.pathname === "/api/v1/playbooks/search") {
        return new Response("Not Found", { status: 404 });
      }
      return jsonResponse([
        {
          id: "nod_weekly",
          parentId: "nod_sales",
          type: "skill",
          slug: "weekly-report",
          name: "Weekly Report",
          description: "Compile the weekly sales report",
          metadata: {},
          settings: {},
          explicitVisibility: null,
          icon: null,
          position: 0,
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-02T00:00:00.000Z",
          baseId: null,
          children: [],
        },
        {
          id: "nod_triage",
          parentId: null,
          type: "skill",
          slug: "triage",
          name: "Ticket Triage",
          description: "Sort tickets by severity",
          metadata: {},
          settings: {},
          explicitVisibility: null,
          icon: null,
          position: 1,
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-02T00:00:00.000Z",
          baseId: null,
          children: [],
        },
      ]);
    }) as typeof fetch;
    const stdout = captureStdout();
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "playbooks",
      "search",
      "--query",
      "weekly report",
      "--query",
      "周报",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      "POST /api/v1/playbooks/search",
      // The oRPC OpenAPI link's bracket encoding of `types: ["skill"]`.
      "GET /api/v1/nodes?types%5B0%5D=skill",
    ]);
    const result = JSON.parse(stdout()) as {
      items: Array<{ kind: string; nodeId: string; matchedOn: string[] }>;
      total: number;
      coverage: { prompts?: string; skillsScanned: number; promptNodesScanned: number };
    };
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: "skill", nodeId: "nod_weekly" });
    expect(result.items[0]?.matchedOn).toEqual(["name"]);
    expect(result.coverage).toEqual({
      skillsScanned: 2,
      promptNodesScanned: 0,
      prompts: "unsupported by this server",
    });
    // Loud, never silent: the degradation is on stderr too.
    expect(stderr.mock.calls.flat().join("\n")).toContain("custom node prompts were NOT searched");
  });

  it("does not fall back on a non-404 failure", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push(new URL(request.url).pathname);
      return new Response(JSON.stringify({ code: "FORBIDDEN", message: "nope" }), {
        headers: { "content-type": "application/json" },
        status: 403,
      });
    }) as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "playbooks",
      "search",
      "--query",
      "anything",
    ]);

    expect(exitCode).toBe(EXIT_CODES.FORBIDDEN);
    expect(calls).toEqual(["/api/v1/playbooks/search"]);
  });

  it("routes playbooks get to GET /playbooks/{kind}/{nodeId} with the key as a query param", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      calls.push(`${request.method} ${url.pathname}?${url.searchParams.toString()}`);
      return jsonResponse({
        kind: "prompt",
        nodeId: "nod_visits",
        nodeType: "base",
        nodeName: "Visits",
        nodeSlug: "visits",
        path: [],
        key: "log-visit",
        content: "Target: …",
      });
    }) as typeof fetch;
    captureStdout();

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "playbooks",
      "get",
      "--kind",
      "prompt",
      "--node-id",
      "nod_visits",
      "--key",
      "log-visit",
    ]);

    expect(exitCode).toBe(0);
    expect(calls).toEqual(["GET /api/v1/playbooks/prompt/nod_visits?key=log-visit"]);
  });

  it("refuses playbooks get --kind prompt without --key before any request", async () => {
    global.fetch = vi.fn() as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const exitCode = await runCli([
      "--base-url",
      "http://localhost:15419",
      "playbooks",
      "get",
      "--kind",
      "prompt",
      "--node-id",
      "nod_visits",
    ]);

    expect(exitCode).toBe(EXIT_CODES.VALIDATION);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("documents search --sources nodes and that custom prompts are appended, not replacing", () => {
    expect(HELP_ALL).toContain("playbooks search");
    expect(HELP_ALL).toContain("playbooks get");
    const program = buildProgram();
    const search = program.commands.find((cmd) => cmd.name() === "search");
    const sources = search?.options.find((option) => option.long === "--sources");
    expect(sources?.description).toContain('"nodes"');
    const setPrompts = program.commands
      .find((cmd) => cmd.name() === "nodes")
      ?.commands.find((cmd) => cmd.name() === "set-agent-prompts");
    expect(setPrompts?.description()).toContain("ADDED after the node type's built-in");
    expect(setPrompts?.description()).not.toContain("instead of");
  });
});
