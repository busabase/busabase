import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import type { AirAppPreviewStateVO } from "busabase-contract/domains/airapp/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { proxyLocalPreview } from "../src/domains/airapp/logic/local-preview-proxy";
import { LOCAL_PREVIEW_OWNER } from "../src/domains/airapp/logic/local-preview-registry";
import { __resetRunSessionsForTest } from "../src/domains/airapp/logic/run-session";
import { resolveSandockConfig, sandockClient } from "../src/domains/airapp/logic/sandock-runtime";
import { createBusabaseOpenApiHandler } from "../src/openapi/handler";
import { busabaseRouter } from "../src/router";

/** Real HTTP -> contract -> logic -> PGLite/files -> runtime -> preview proxy.
 * Default: real host process, no external credentials. To verify Sandock Cloud,
 * set AIRAPP_PREVIEW_HTTP_ENGINE=remote plus SANDOCK_API_KEY/BASE_URL/SPACE_ID.
 * The remote mode uses the real provider; it does not substitute API handlers.
 */
const ENGINE = process.env.AIRAPP_PREVIEW_HTTP_ENGINE === "remote" ? "remote" : "local";
const READY_TIMEOUT_MS = ENGINE === "remote" ? 300_000 : 15_000;
const STORY_TIMEOUT_MS = ENGINE === "remote" ? 660_000 : 60_000;
const SERVER_JS = `const http = require('node:http');
const fs = require('node:fs');
const server = http.createServer((_request, response) => {
  response.setHeader('content-type', 'text/html');
  response.end(fs.readFileSync('public/index.html'));
});
server.listen(Number(process.env.PORT), '0.0.0.0', () => {
  console.log('listening on port ' + server.address().port);
});`;
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("agent runtime preview over HTTP", () => {
  let originalCwd = "";
  let tempDir = "";
  let server: Server;
  let origin = "";
  const savedEnv = new Map<string, string | undefined>();
  const client = createRouterClient(busabaseRouter);
  let remoteSandboxId: string | undefined;
  let remoteApi: ReturnType<typeof sandockClient> | undefined;

  beforeAll(async () => {
    if (ENGINE === "remote") {
      const config = resolveSandockConfig();
      if (!config)
        throw new Error("Remote HTTP verification requires a real Sandock API configuration.");
      remoteApi = sandockClient(config);
      await remoteApi.sandbox.list();
    }
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    tempDir = await mkdtemp(path.join(os.tmpdir(), "busabase-agent-preview-"));
    for (const [key, value] of Object.entries({
      PG_DATABASE_URL: `pglite://${path.join(tempDir, "db")}`,
      STORAGE_URL: `local:${path.join(tempDir, "storage")}?base_url=/api/test/storage`,
      SANDAGENT_WORKDIR: path.join(tempDir, "runs"),
      APP_ENV: "LOCAL",
    })) {
      savedEnv.set(key, process.env[key]);
      process.env[key] = value;
    }
    const handler = createBusabaseOpenApiHandler(busabaseRouter);
    server = createServer(async (incoming, outgoing) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const request = new Request(`${origin}${incoming.url}`, {
          method: incoming.method,
          headers: new Headers(incoming.headers as Record<string, string>),
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        });
        const preview = new URL(request.url).pathname.match(
          /^\/api\/airapp-preview\/([^/]+)\/(.*)$/,
        );
        const context = incoming.headers["x-test-read-only"]
          ? {
              isSpaceManager: false,
              permissionLevel: "read" as const,
              credentialPermissionCeiling: "read" as const,
            }
          : {};
        const response = await runWithBusabaseContext(context, async () => {
          if (preview)
            return proxyLocalPreview(request, preview[1]!, preview[2]!, LOCAL_PREVIEW_OWNER);
          const result = await handler.handle(request, { context: {} });
          return result.matched ? result.response : new Response("Not found", { status: 404 });
        });
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        outgoing.writeHead(500);
        outgoing.end(String(error));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP test server did not bind");
    origin = `http://127.0.0.1:${address.port}`;
  }, 120_000);

  afterAll(
    async () => {
      try {
        await __resetRunSessionsForTest();
        if (remoteApi && remoteSandboxId) {
          const remaining = await remoteApi.sandbox.list();
          expect(
            remaining.data.items.some(({ id }) => id === remoteSandboxId),
            "Remote sandbox was deleted during cleanup",
          ).toBe(false);
        }
      } finally {
        if (server)
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        for (const [key, value] of savedEnv) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        if (originalCwd) process.chdir(originalCwd);
        if (tempDir) await rm(tempDir, { recursive: true, force: true });
      }
    },
    ENGINE === "remote" ? 180_000 : 30_000,
  );

  const call = (nodeId: string, suffix = "", body?: unknown, readOnly = false) =>
    fetch(`${origin}/api/v1/airapps/${encodeURIComponent(nodeId)}/preview${suffix}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(readOnly ? { "x-test-read-only": "true" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const waitForRunning = async (nodeId: string): Promise<AirAppPreviewStateVO> => {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const response = await call(nodeId);
      expect(response.status).toBe(200);
      const state = (await response.json()) as AirAppPreviewStateVO;
      if (state.status === "running") return state;
      if (state.status === "failed") throw new Error(`${state.error}\n${state.logs.join("")}`);
      await new Promise((resolve) => setTimeout(resolve, ENGINE === "remote" ? 500 : 50));
    }
    throw new Error("Preview did not become ready");
  };

  it(
    "starts merged source, serves the returned URL, reports logs, and stops the real process",
    async () => {
      const app = await client.fileTrees.create({
        type: "airapp",
        autoMerge: true,
        mergeMode: "replace",
        slug: "agent-preview-http",
        name: "Agent HTTP preview",
        files: [
          {
            path: "package.json",
            content: JSON.stringify({ private: true, scripts: { dev: "node server.js" } }),
          },
          {
            path: "airapp.json",
            content: JSON.stringify({
              runtime: "node",
              install: "node -e \"process.stdout.write('installed successfully\\n')\"",
              start: "node server.js",
            }),
          },
          { path: "server.js", content: SERVER_JS },
          { path: "public/index.html", content: "<h1>merged original</h1>" },
        ],
      });
      const nodeId = app.node.id;
      const currentFile = await client.fileTrees.readFile({
        type: "airapp",
        nodeId,
        filePath: "public/index.html",
      });
      const pending = await client.fileTrees.createChangeRequest({
        type: "airapp",
        nodeId,
        autoMerge: false,
        operations: [
          {
            kind: "update",
            path: "public/index.html",
            content: "<h1>approved update</h1>",
            baseContentHash: currentFile.contentHash,
          },
        ],
      });
      expect(pending.status).toBe("in_review");
      expect((await call(nodeId, "/start", {})).status).toBe(400);
      expect((await call(nodeId, "/start", { engine: ENGINE }, true)).status).toBe(403);
      expect((await call(nodeId)).status).toBe(200);
      expect((await call(nodeId, "/start", { engine: ENGINE })).status).toBe(200);
      const state = await waitForRunning(nodeId);
      expect(state.engine).toBe(ENGINE);
      expect(state.logs.join("")).toContain("installed successfully");
      expect(state.previewUrl).toBe(`/api/airapp-preview/${nodeId}/`);
      if (remoteApi) {
        const sandboxes = await remoteApi.sandbox.list();
        remoteSandboxId = sandboxes.data.items.find(
          (item) => (item as typeof item & { title?: string }).title === `AirApp ${nodeId}`,
        )?.id;
        expect(remoteSandboxId, "A real provider sandbox exists for this AirApp").toBeTruthy();
      }
      const rendered = await fetch(`${origin}${state.previewUrl}`);
      expect(rendered.status).toBe(200);
      expect(await rendered.text()).toContain("merged original");
      expect((await call(nodeId, "/start", { engine: ENGINE })).status).toBe(200);
      expect((await (await call(nodeId)).json()).previewUrl).toBe(state.previewUrl);
      expect(await (await call(nodeId, "/stop", {})).json()).toEqual({ stopped: true });
      expect((await (await call(nodeId)).json()).status).toBe("stopped");
      if (remoteApi && remoteSandboxId) {
        const sandbox = await remoteApi.sandbox.get(remoteSandboxId);
        expect(sandbox.data.status.toUpperCase()).toBe("STOPPED");
      }
      expect((await fetch(`${origin}${state.previewUrl}`)).status).toBe(404);
      expect(await (await call(nodeId, "/stop", {})).json()).toEqual({ stopped: false });
      await client.changeRequests.review({ changeRequestIds: [pending.id], verdict: "approved" });
      const merged = await client.changeRequests.merge({ changeRequestIds: [pending.id] });
      expect(merged.results[0]?.ok).toBe(true);
      expect((await call(nodeId, "/start", { engine: ENGINE })).status).toBe(200);
      const restarted = await waitForRunning(nodeId);
      expect(await (await fetch(`${origin}${restarted.previewUrl}`)).text()).toContain(
        "approved update",
      );
      await call(nodeId, "/stop", {});
    },
    STORY_TIMEOUT_MS,
  );

  it("rejects wrong-kind and nonexistent nodes before starting execution", async () => {
    const skill = await client.fileTrees.create({
      type: "skill",
      slug: "agent-preview-wrong-kind",
      name: "Not an app",
      autoMerge: true,
    });
    expect((await call(skill.node.id, "/start", { engine: ENGINE })).status).toBe(404);
    expect((await call(skill.node.id)).status).toBe(404);
    expect((await call("missing-app", "/start", { engine: ENGINE })).status).toBe(404);
  }, 60_000);
});
