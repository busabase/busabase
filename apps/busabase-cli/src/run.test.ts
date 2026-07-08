import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HELP, runCli } from "./run";

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
    expect(HELP).toContain("nodes create-change-request --type <folder|base|skill|drive|file|doc>");
    expect(HELP).toContain("--asset-id <id>");
    expect(HELP).toContain("change-requests close --change-request-id <id>");
    expect(HELP).toContain("records list [--limit <n>] [--base-id <id>] [--cursor <cursor>]");
    expect(HELP).toContain("assets upload --file <path>");
    expect(HELP).not.toContain("attachments upload");
    expect(HELP).toContain("rejected = request changes, not terminal");
    expect(HELP).not.toContain(["create", "dra", "ft"].join("-"));
    expect(HELP).not.toContain(["dra", "fts "].join(""));
    expect(HELP).not.toContain(["--dra", "ft-id"].join(""));
    expect(HELP).not.toContain("--attachment-id <id>");
    expect(HELP).not.toContain("--content-hash <hash>");
  });

  it("generates commands for the full OpenAPI surface (previously uncovered domains)", () => {
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
  });

  it("keeps curated commands over generated duplicates", () => {
    // records.search / records.listChangeRequests are aliased by curated commands,
    // so the generator must NOT emit `records search` / `records list-change-requests`.
    expect(HELP).toContain("records by-field-text");
    expect(HELP).toContain("records change-requests --record-id <id>");
    expect(HELP).not.toContain("records search ");
    expect(HELP).not.toContain("records list-change-requests");
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

  it("routes a generated mutation with a path param and JSON body", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await request.json() : null,
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
        method: "PUT",
        url: "http://localhost:15419/api/v1/records/rec_1/change-requests",
        body: { fields: { title: "Updated" } },
      }),
    ]);
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
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/nodes/change-requests",
        body: {
          message: "Create base 内容 Content",
          operations: [
            {
              fields: JSON.parse(fields),
              kind: "create",
              name: "内容 Content",
              nodeType: "base",
              slug: "content",
            },
          ],
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
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:15419/api/v1/nodes/change-requests",
        body: {
          message: "Create file Board Plan",
          operations: [
            {
              description: "Planning PDF",
              kind: "create",
              metadata: { assetId: "ast_1" },
              name: "Board Plan",
              nodeType: "file",
              parentNodeId: "nod_parent",
              slug: "board-plan",
            },
          ],
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
    expect(error.mock.calls.join("\n")).toContain("--asset-id is required with --type file");
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

  it("lists records through the paged endpoint with base and cursor filters", async () => {
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
      "list",
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
        url: "http://localhost:15419/api/v1/records/paged?limit=100&baseId=bse_1&cursor=cur_1",
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
      "list",
      "--limit",
      "101",
    ]);

    expect(exitCode).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("uploads assets and prints an asset-backed record-field ref", async () => {
    const dir = await mkdtemp(join(tmpdir(), "busabase-cli-"));
    const file = join(dir, "cover.svg");
    await writeFile(file, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({
        body: request.body ? await requestBody(request) : null,
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

    expect(exitCode).toBe(1);
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
        method: "PATCH",
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

  it("login --refresh slides the saved OAuth session forward", async () => {
    const home = await mkdtemp(join(tmpdir(), "busabase-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = home;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await mkdir(join(home, ".busabase"), { recursive: true });
    await writeFile(
      join(home, ".busabase", ".env"),
      "BUSABASE_BASE_URL=http://localhost:15419\nBUSABASE_API_KEY=bss_old\nBUSABASE_TOKEN_EXPIRES_AT=2020-01-01T00:00:00.000Z\n",
    );
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push(`${request.method} ${request.url}`);
      expect(request.headers.get("authorization")).toBe("Bearer bss_old");
      return jsonResponse({ token: "bss_old", expiresAt: "2099-01-01T00:00:00.000Z" });
    }) as typeof fetch;

    try {
      const exitCode = await runCli(["login", "--refresh"]);
      expect(exitCode).toBe(0);
      expect(calls).toEqual(["POST http://localhost:15419/api/oauth/refresh"]);
      const env = await readFile(join(home, ".busabase", ".env"), "utf8");
      expect(env).toContain("BUSABASE_API_KEY=bss_old");
      expect(env).toContain("BUSABASE_TOKEN_EXPIRES_AT=2099-01-01T00:00:00.000Z");
    } finally {
      process.env.HOME = originalHome;
      await rm(home, { force: true, recursive: true });
    }
  });

  it("prints response bodies for server-side failures", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    global.fetch = vi.fn(
      async () => new Response('{"error":"storage missing"}', { status: 500 }),
    ) as typeof fetch;

    const exitCode = await runCli(["--base-url", "http://localhost:15419", "records", "list"]);

    expect(exitCode).toBe(1);
    expect(error.mock.calls.join("\n")).toContain('HTTP 500 : {"error":"storage missing"}');
  });
});
