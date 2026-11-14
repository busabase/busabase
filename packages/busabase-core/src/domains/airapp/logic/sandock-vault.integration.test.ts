/**
 * Opt-in real HTTP/child-process check against apps/sandock's LOCAL provider:
 * AIRAPP_SANDOCK_URL=http://127.0.0.1:18370 vitest run .../sandock-vault.integration.test.ts
 * The relay replaces only workspace preparation with an environment probe,
 * then deliberately fails that step. This tests the credential boundary without
 * needing a container filesystem or Sandock Cloud's signed-preview procedure.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../../../context";

vi.mock("../../../logic/node-acl", () => ({
  assertNodePermission: vi.fn(async () => undefined),
}));

const liveUrl = process.env.AIRAPP_SANDOCK_URL;

describe.skipIf(!liveUrl)("remote Vault snapshot through Sandock HTTP", () => {
  let relay: Server;
  let expectedDigest = "";
  let expectedUrl = "";
  let observedEnvironment: Record<string, string> | undefined;
  let probePassed = false;
  const previousUrl = process.env.SANDOCK_BASE_URL;
  const previousKey = process.env.SANDOCK_API_KEY;

  beforeAll(async () => {
    relay = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const raw = Buffer.concat(chunks).toString("utf8");
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
        const path = request.url ?? "/";
        if (path === "/api/v1/sandbox" && request.method === "POST") {
          observedEnvironment = body?.env as Record<string, string>;
        }
        const isPreparation = path.endsWith("/shell") && typeof body?.cmd === "string";
        if (isPreparation && body) {
          // The probe prints only booleans/markers, never a credential. Exit 31
          // is intentional: the runner must clean up after this verification.
          const code = [
            "import os, hashlib",
            `assert hashlib.sha256(os.environ['ARGOCD_AWS_TOKEN'].encode()).hexdigest() == '${expectedDigest}'`,
            `assert os.environ['ARGOCD_AWS_BASE_URL'] == '${expectedUrl}'`,
            "assert os.environ['BUSABASE_AIRAPP_RUNTIME'] == 'remote'",
            "assert os.environ['PORT'] == '3000'",
            "print('VAULT_PROCESS_PROBE_OK')",
          ].join("; ");
          body.cmd = `python3 -c "${code}"; exit 31`;
        }
        const upstream = await fetch(`${liveUrl}${path}`, {
          method: request.method,
          headers: body ? { "content-type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
        const text = await upstream.text();
        if (isPreparation) {
          const result = JSON.parse(text) as { data?: { stdout?: string; exitCode?: number } };
          probePassed =
            result.data?.stdout?.includes("VAULT_PROCESS_PROBE_OK") === true &&
            result.data?.exitCode === 31;
        }
        response.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") ?? "application/json",
        });
        response.end(text);
      } catch (error) {
        response.writeHead(502);
        response.end(error instanceof Error ? error.name : "RelayError");
      }
    });
    await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
    process.env.SANDOCK_BASE_URL = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;
    process.env.SANDOCK_API_KEY = "local-integration-test";
  });

  afterAll(async () => {
    const { __resetRunSessionsForTest } = await import("./run-session");
    await __resetRunSessionsForTest();
    if (previousUrl === undefined) delete process.env.SANDOCK_BASE_URL;
    else process.env.SANDOCK_BASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SANDOCK_API_KEY;
    else process.env.SANDOCK_API_KEY = previousKey;
    await new Promise<void>((resolve, reject) =>
      relay.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("delivers each owner's snapshot to a real process without changing host env", async () => {
    const { runOrAttachSession } = await import("./run-session");
    const originalHostValue = process.env.ARGOCD_AWS_TOKEN;
    for (const owner of ["vault-http-user-one", "vault-http-user-two"]) {
      const token = `test-only-${owner}-credential`;
      expectedUrl = `https://${owner}.example.test`;
      expectedDigest = createHash("sha256").update(token).digest("hex");
      observedEnvironment = undefined;
      probePassed = false;
      const events = await runWithBusabaseContext(
        {
          actorId: owner,
          vaultRuntimeEnv: {
            ARGOCD_AWS_TOKEN: token,
            ARGOCD_AWS_BASE_URL: expectedUrl,
            BUSABASE_AIRAPP_RUNTIME: "cannot-override-platform",
            PORT: "9999",
          },
        },
        async () => {
          const collected = [];
          for await (const event of runOrAttachSession({
            nodeId: "vault-http-node",
            engine: "remote",
            files: { "package.json": JSON.stringify({ scripts: { dev: "node server.js" } }) },
          })) {
            collected.push(event);
          }
          return collected;
        },
      );
      expect(observedEnvironment).toMatchObject({
        ARGOCD_AWS_TOKEN: token,
        ARGOCD_AWS_BASE_URL: expectedUrl,
        BUSABASE_AIRAPP_RUNTIME: "remote",
        PORT: "3000",
      });
      expect(probePassed).toBe(true);
      expect(events.some((event) => event.type === "error")).toBe(true);
      expect(JSON.stringify(events)).not.toContain(token);
      expect(process.env.ARGOCD_AWS_TOKEN).toBe(originalHostValue);
    }
  }, 120_000);
});
