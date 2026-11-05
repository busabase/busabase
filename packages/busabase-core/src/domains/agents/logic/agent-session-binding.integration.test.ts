import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../../../context";
import * as schema from "../../../db/schema";
import { decodeVaultValue, encodeVaultValue } from "../../vault/logic/vault-crypto";
import { busabaseVaultItems } from "../../vault/schema/vault-items";
import { agentSessionBindingFingerprint } from "./agent-session-binding";
import {
  admitSessionCommand,
  createJournalSession,
  getJournalRuntime,
} from "./agent-session-journal-store";
import {
  disconnectBuda,
  getBudaAcpUrl,
  getBudaConnection,
  getBudaConnectionDetail,
  listBudaConnections,
  saveBudaConnection,
} from "./buda-connection";

describe("Buda binding revision with encrypted real vault persistence", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const asOwner = <T>(fn: () => Promise<T>) =>
    runWithBusabaseContext(
      { db, actorId: "binding-owner", spaceId: "binding-space", isSpaceManager: true },
      fn,
    );
  const oauth = {
    accessToken: "private-old-token",
    refreshToken: "private-refresh-token",
    expiresAt: "2000-01-01T00:00:00Z",
    agentId: "binding-agent",
    agentName: "Binding Agent",
  };
  const api = {
    kind: "api-token" as const,
    endpoint: "wss://buda.example/api/acp?agentId=binding-agent",
    accessToken: "private-api-token",
    agentId: "binding-agent",
    agentName: "Binding Agent",
  };

  beforeAll(async () => {
    vi.stubEnv("BUSABASE_VAULT_ENCRYPTION_KEY", "binding-integration-fixture-key");
    client = await PGlite.create({ extensions: { pg_trgm } });
    db = drizzle({ client, schema });
    await migrate(db, {
      migrationsFolder: path.resolve(
        import.meta.dirname,
        "../../../../../../apps/busabase/src/db/migrations",
      ),
    });
  });
  beforeEach(async () => {
    await db.delete(busabaseVaultItems);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "private-rotated-token",
              refresh_token: "private-rotated-refresh",
              expires_in: 3600,
            }),
            { status: 200 },
          ),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await client.close();
    vi.unstubAllEnvs();
  });

  it("keeps the vault identity and revision through OAuth refresh and excludes refs from public VOs", async () => {
    await asOwner(async () => {
      const slug = await saveBudaConnection(oauth);
      const [row] = await db.select().from(busabaseVaultItems);
      if (!row) throw new Error("Missing saved fixture credential");
      const saved = JSON.parse(decodeVaultValue(row.valuePayload)) as {
        connectionRevision: string;
      };
      const bindingRef = `${row.id}:${saved.connectionRevision}`;
      const before = agentSessionBindingFingerprint({
        slug,
        url: getBudaAcpUrl(oauth.agentId),
        authHeader: `Bearer ${oauth.accessToken}`,
        bindingRef,
      });
      const refreshed = await getBudaConnection(slug);
      expect(refreshed?.accessToken).toBe("private-rotated-token");
      expect(refreshed?.bindingRef).toBe(bindingRef);
      expect(
        agentSessionBindingFingerprint({
          slug,
          url: getBudaAcpUrl(oauth.agentId),
          authHeader: `Bearer ${refreshed?.accessToken}`,
          bindingRef: refreshed?.bindingRef,
        }),
      ).toBe(before);
      const [next] = await db.select().from(busabaseVaultItems);
      if (!next) throw new Error("Missing refreshed fixture credential");
      expect(JSON.parse(decodeVaultValue(next.valuePayload)).connectionRevision).toBe(
        saved.connectionRevision,
      );
      const publicData = JSON.stringify([
        await listBudaConnections(),
        await getBudaConnectionDetail(slug),
      ]);
      expect(publicData).not.toContain("bindingRef");
      expect(publicData).not.toContain(saved.connectionRevision);
      expect(publicData).not.toContain("private-");
    });
  });

  it("rotates explicit reconnects even on the same vault row and atomically pins queued intent", async () => {
    await asOwner(async () => {
      vi.stubEnv("BUSABASE_AGENT_SUPERVISOR_ENABLED", "true");
      vi.stubEnv("BUSABASE_AGENT_LEGACY_WRITERS_DRAINED", "true");
      const slug = await saveBudaConnection(api);
      const original = await getBudaConnection(slug);
      if (!original) throw new Error("Missing connection");
      const pin = agentSessionBindingFingerprint({
        slug,
        url: original.endpoint,
        authHeader: `Bearer ${original.accessToken}`,
        bindingRef: original.bindingRef,
      });
      const now = new Date().toISOString();
      const id = "ags_binding_queued";
      const scope = { spaceId: "binding-space", actorId: "binding-owner" };
      await createJournalSession(
        {
          id,
          slug,
          agentName: "Binding Agent",
          transport: "remote-websocket",
          status: "idle",
          createdAt: now,
          lastActivityAt: now,
          error: null,
          modelOption: null,
        },
        scope,
        { bindingFingerprint: pin },
      );
      await admitSessionCommand(
        id,
        {
          commandId: "command_binding_pending",
          kind: "prompt",
          payload: { text: "queued original intent" },
        },
        scope,
      );
      await saveBudaConnection({ ...api, accessToken: "private-replacement-token" });
      const replacement = await getBudaConnection(slug);
      expect(replacement?.bindingRef.split(":")[0]).toBe(original.bindingRef.split(":")[0]);
      expect(replacement?.bindingRef).not.toBe(original.bindingRef);
      const current = agentSessionBindingFingerprint({
        slug,
        url: replacement?.endpoint,
        authHeader: `Bearer ${replacement?.accessToken}`,
        bindingRef: replacement?.bindingRef,
      });
      expect(current).not.toBe(pin);
      expect((await getJournalRuntime(id, scope))?.capabilities?.bindingFingerprint).toBe(pin);
      const publicData = JSON.stringify(await getBudaConnectionDetail(slug));
      expect(publicData).not.toContain("bindingRef");
      expect(publicData).not.toContain("private-replacement-token");
      vi.stubEnv("BUSABASE_AGENT_SUPERVISOR_ENABLED", "false");
      vi.stubEnv("BUSABASE_AGENT_LEGACY_WRITERS_DRAINED", "false");
    });
  });

  it("does not let a delayed OAuth refresh overwrite an explicit replacement", async () => {
    await asOwner(async () => {
      const slug = await saveBudaConnection(oauth);
      let release!: () => void;
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          entered();
          await gate;
          return new Response(
            JSON.stringify({
              access_token: "private-stale-refreshed-token",
              refresh_token: "private-stale-refreshed-refresh",
              expires_in: 3600,
            }),
            { status: 200 },
          );
        }),
      );
      const refreshing = getBudaConnection(slug);
      // Attach rejection handling before releasing the asynchronous provider.
      const outcome = refreshing.then(
        () => null,
        (error: unknown) => error,
      );
      await ready;
      await saveBudaConnection(api);
      const replacement = await getBudaConnection(slug);
      release();
      expect(await outcome).toBeInstanceOf(Error);
      expect((await getBudaConnection(slug))?.bindingRef).toBe(replacement?.bindingRef);
      expect((await getBudaConnection(slug))?.accessToken).toBe(api.accessToken);
      expect((await getBudaConnection(slug))?.endpoint).toBe(api.endpoint);
    });
  });

  it("gives a disconnected and newly created credential a new binding identity", async () => {
    await asOwner(async () => {
      const slug = await saveBudaConnection(api);
      const original = await getBudaConnection(slug);
      expect(await disconnectBuda(slug)).toBe(true);
      expect(await getBudaConnection(slug)).toBeNull();
      await saveBudaConnection(api);
      expect((await getBudaConnection(slug))?.bindingRef).not.toBe(original?.bindingRef);
    });
  });

  it("keeps legacy OAuth rows stable without inventing a revision during refresh", async () => {
    await asOwner(async () => {
      await db.insert(busabaseVaultItems).values({
        id: "vlt_legacy_binding",
        userId: "binding-owner",
        kind: "secret",
        key: "BUDA_ACP_CONNECTION",
        valuePayload: encodeVaultValue(JSON.stringify(oauth), { requireEncryption: true }),
        scopeType: "workspace",
        scopeId: "binding-space",
        environment: "production",
      });
      const refreshed = await getBudaConnection("buda:binding-agent");
      expect(refreshed?.bindingRef).toBe("vlt_legacy_binding");
      expect(refreshed?.accessToken).toBe("private-rotated-token");
      const [row] = await db.select().from(busabaseVaultItems);
      if (!row) throw new Error("Missing legacy fixture credential");
      expect(JSON.parse(decodeVaultValue(row.valuePayload))).not.toHaveProperty(
        "connectionRevision",
      );
    });
  });
});
