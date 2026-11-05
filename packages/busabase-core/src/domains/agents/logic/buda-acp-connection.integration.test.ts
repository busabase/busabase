import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { runWithBusabaseContext } from "../../../context";
import * as schema from "../../../db/schema";
import { busabaseVaultItems } from "../../vault/schema/vault-items";
import { resolveLaunch } from "./agent-catalog";
import { connectBudaAcp } from "./buda-acp-connection";
import {
  disconnectBuda,
  getBudaConnection,
  getBudaConnectionDetail,
  listBudaConnections,
} from "./buda-connection";

describe("Buda API-token connect — real WebSocket and encrypted PGlite", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: WebSocketServer;
  let endpoint: string;
  const requests: Array<{ url: string; authorization: string | undefined; method: string }> = [];
  const asOwner = <T>(fn: () => Promise<T>) =>
    runWithBusabaseContext({ db, actorId: "owner", spaceId: "buda-acp-test" }, fn);

  beforeAll(async () => {
    vi.stubEnv("BUSABASE_VAULT_ENCRYPTION_KEY", "buda-acp-integration-test-key");
    client = new PGlite({ extensions: { pg_trgm } });
    db = drizzle({ client, schema });
    await migrate(db, {
      migrationsFolder: path.resolve(
        import.meta.dirname,
        "../../../../../../apps/busabase/src/db/migrations",
      ),
    });
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("No fixture address");
    endpoint = `ws://127.0.0.1:${address.port}/api/acp`;
    vi.stubEnv("BUDA_ACP_URL", endpoint);
    server.on("connection", (socket, request) => {
      socket.on("message", (message) => {
        const input = JSON.parse(String(message)) as { id: number; method: string };
        requests.push({
          url: request.url ?? "",
          authorization: request.headers.authorization,
          method: input.method,
        });
        if (new URL(request.url ?? "/", "http://fixture").searchParams.get("agentId") === "silent")
          return;
        const agentId = new URL(request.url ?? "/", "http://fixture").searchParams.get("agentId");
        const valid =
          request.headers.authorization === "Bearer fixture-api-token" &&
          (agentId === "fixture-agent" || agentId === "unsupported-protocol");
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: input.id,
            ...(valid
              ? {
                  result: {
                    protocolVersion: agentId === "unsupported-protocol" ? 2 : 1,
                    agentCapabilities: {},
                    agentInfo: { name: "Fixture agent", version: "1" },
                  },
                }
              : {
                  error: {
                    code: -32000,
                    message: `Rejected credential: ${request.headers.authorization}`,
                  },
                }),
          }),
        );
      });
    });
  });
  afterAll(async () => {
    for (const socket of server?.clients ?? []) socket.terminate();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await client?.close();
    vi.unstubAllEnvs();
  });

  it("initializes before saving, encrypts the token and resolves the same endpoint for chat", async () => {
    await asOwner(async () => {
      const result = await connectBudaAcp({
        endpoint,
        agentId: "fixture-agent",
        apiToken: "fixture-api-token",
      });
      expect(result).toEqual({ slug: "buda:fixture-agent" });
      expect(requests.at(-1)).toEqual({
        url: "/api/acp?agentId=fixture-agent",
        authorization: "Bearer fixture-api-token",
        method: "initialize",
      });
      const rows = await db.select().from(busabaseVaultItems);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.valuePayload.encoding).toBe("encrypted");
      expect(JSON.stringify(rows)).not.toContain("fixture-api-token");
      expect(await getBudaConnection(result.slug)).toMatchObject({
        endpoint: `${endpoint}?agentId=fixture-agent`,
      });
      expect(await resolveLaunch(result.slug)).toMatchObject({
        url: `${endpoint}?agentId=fixture-agent`,
        authHeader: "Bearer fixture-api-token",
      });
      expect(JSON.stringify(await getBudaConnectionDetail(result.slug))).not.toMatch(
        /fixture-api-token|accessToken|endpoint/,
      );
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await disconnectBuda(result.slug);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
      expect(await listBudaConnections()).toEqual([]);
    });
  });

  it("does not save an invalid token or agent and does not expose echoed credentials", async () => {
    await asOwner(async () => {
      for (const input of [
        { endpoint, agentId: "fixture-agent", apiToken: "invalid-secret" },
        { endpoint, agentId: "other-agent", apiToken: "fixture-api-token" },
      ]) {
        await expect(connectBudaAcp(input)).rejects.toThrow(
          "Could not connect to Buda. Check the endpoint, agent ID, and API token.",
        );
      }
      expect(await listBudaConnections()).toEqual([]);
    });
  });

  it("bounds an unresponsive ACP initialize and leaves no saved credential", async () => {
    await asOwner(async () => {
      await expect(
        connectBudaAcp({ endpoint, agentId: "silent", apiToken: "fixture-api-token" }),
      ).rejects.toThrow("Buda did not respond in time.");
      expect(await listBudaConnections()).toEqual([]);
    });
  });

  it("rejects an unsupported initialized protocol before saving", async () => {
    await asOwner(async () => {
      await expect(
        connectBudaAcp({
          endpoint,
          agentId: "unsupported-protocol",
          apiToken: "fixture-api-token",
        }),
      ).rejects.toThrow("Buda returned an unsupported ACP protocol version.");
      expect(await listBudaConnections()).toEqual([]);
    });
  });
});
