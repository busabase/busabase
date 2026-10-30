import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../../../context";
import { getDb } from "../../../db";
import {
  clearVaultSettings,
  getVaultSettings,
  updateVaultSettings,
} from "../../vault/logic/vault-logic";
import { getAgentConnectionDetail, renameAgentConnection } from "./agent-connection-detail";
import { connectionDisplayName, listConnectionNames } from "./agent-connection-name";
import { getBudaConnection, listBudaConnections, saveBudaConnection } from "./buda-connection";

const asActor = <T>(actorId: string, spaceId: string, fn: () => Promise<T>) =>
  runWithBusabaseContext({ actorId, spaceId }, fn);
const credential = (agentId: string, agentName = "Original agent") => ({
  agentId,
  agentName,
  accessToken: "private-access-token",
  refreshToken: "private-refresh-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
});

describe("saved agent connection details and names", () => {
  let dataDir = "";
  let originalCwd = "";
  const previousDb = process.env.PG_DATABASE_URL;
  const previousSecret = process.env.BETTER_AUTH_SECRET;
  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-connection-detail-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.BETTER_AUTH_SECRET = "connection-details-test-secret";
  });
  afterAll(async () => {
    if (previousDb === undefined) delete process.env.PG_DATABASE_URL;
    else process.env.PG_DATABASE_URL = previousDb;
    if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = previousSecret;
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("persists a trimmed display name while preserving the provider identity and safe details", async () => {
    await asActor("owner", "names", async () => {
      const slug = await saveBudaConnection(credential("agent-1"));
      const detail = await renameAgentConnection(slug, "  Research assistant  ");
      expect(detail).toEqual({
        slug,
        agentName: "Research assistant",
        provider: "buda",
        providerAgentName: "Original agent",
        agentId: "agent-1",
        transport: "remote-websocket",
        status: "saved",
        ownedByCurrentUser: true,
        connectedBy: { id: "owner", name: null, email: null, image: null, role: null },
      });
      expect(JSON.stringify(detail)).not.toMatch(/private|Token|wss:/);
      expect((await listBudaConnections())[0]?.agentName).toBe("Research assistant");
      // The name lives outside the replaced OAuth credential payload.
      await saveBudaConnection(credential("agent-1", "Provider renamed agent"));
      expect(await getAgentConnectionDetail(slug)).toMatchObject({
        slug,
        agentName: "Research assistant",
        providerAgentName: "Provider renamed agent",
      });
      await renameAgentConnection(slug, "Second name");
      expect((await getAgentConnectionDetail(slug)).agentName).toBe("Second name");
    });
  });

  it("keeps the display name when OAuth rotates tokens and updates the provider name", async () => {
    await asActor("owner", "refresh", async () => {
      const slug = await saveBudaConnection({
        ...credential("refresh-agent"),
        expiresAt: "2000-01-01T00:00:00Z",
      });
      await renameAgentConnection(slug, "My assistant");
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                access_token: "rotated-access",
                refresh_token: "rotated-refresh",
                expires_in: 3600,
                agent_name: "Updated provider name",
              }),
              { status: 200 },
            ),
        ),
      );
      await getBudaConnection(slug);
      expect(await getAgentConnectionDetail(slug)).toMatchObject({
        agentName: "My assistant",
        providerAgentName: "Updated provider name",
        slug,
      });
      vi.unstubAllGlobals();
    });
  });

  it("shares safe details and the owner's name but rejects non-owner and cross-space edits", async () => {
    const slug = await asActor("owner", "shared", async () => {
      const slug = await saveBudaConnection(credential("shared-agent"));
      await renameAgentConnection(slug, "Team assistant");
      return slug;
    });
    await asActor("member", "shared", async () => {
      const detail = await getAgentConnectionDetail(slug);
      expect(detail).toMatchObject({
        agentName: "Team assistant",
        ownedByCurrentUser: false,
      });
      // The actual connector is the row's persisted owner ("owner"), never the
      // viewer resolving the detail ("member") — a viewer-substitution bug
      // would silently pass `ownedByCurrentUser: false` while still naming the
      // wrong person here.
      expect(detail.connectedBy?.id).toBe("owner");
      expect(detail.connectedBy?.id).not.toBe("member");
      await expect(renameAgentConnection(slug, "Hijacked name")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
    await expect(
      asActor("owner", "another-space", () => getAgentConnectionDetail(slug)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await asActor("member", "shared", async () => {
      await saveBudaConnection(credential("shared-agent"));
      await renameAgentConnection(slug, "Personal label");
      const ownRow = await getAgentConnectionDetail(slug);
      expect(ownRow.agentName).toBe("Personal label");
      // Now "member" holds the usable row for this space, so attribution
      // correctly flips to describe the new owner, not the original "owner".
      expect(ownRow.connectedBy?.id).toBe("member");
    });
    const ownerRow = await asActor("owner", "shared", () => getAgentConnectionDetail(slug));
    expect(ownerRow.agentName).toBe("Team assistant");
    expect(ownerRow.connectedBy?.id).toBe("owner");
  });

  it("falls back to an honest unresolved identity rather than substituting the viewer", async () => {
    const slug = await asActor("ghost-owner", "unknown-identity", async () => {
      const slug = await saveBudaConnection(credential("unknown-identity-agent"));
      await renameAgentConnection(slug, "Legacy assistant");
      return slug;
    });
    // A host resolver that cannot find the persisted owner (e.g. the account
    // was deleted) must not cause the viewer's own identity to be rendered in
    // its place. `resolveUserRefs` leaves an id the resolver doesn't know
    // about out of its map entirely, so `connectedBy` is honestly null — the
    // UI then renders its localized "Unknown user" fallback, never the viewer.
    await runWithBusabaseContext(
      {
        actorId: "viewer",
        spaceId: "unknown-identity",
        resolveUsers: async () => new Map(),
      },
      async () => {
        const detail = await getAgentConnectionDetail(slug);
        expect(detail.ownedByCurrentUser).toBe(false);
        expect(detail.connectedBy).toBeNull();
      },
    );
  });

  it("rejects empty or oversized names before any write", async () => {
    await asActor("owner", "validation", async () => {
      const slug = await saveBudaConnection(credential("validate-agent"));
      for (const invalid of ["", "   ", "x".repeat(101)]) {
        await expect(renameAgentConnection(slug, invalid)).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      }
      expect((await getAgentConnectionDetail(slug)).agentName).toBe("Original agent");
    });
  });

  it("keeps internal labels out of the editable Vault and preserves them through Vault replacement and clearing", async () => {
    await asActor("vault-owner", "vault-space", async () => {
      const slug = await saveBudaConnection(credential("vault-agent"));
      const database = await getDb();
      const before = await getVaultSettings(database, "vault-owner");
      await renameAgentConnection(slug, "Durable label");
      const after = await getVaultSettings(database, "vault-owner");
      expect(after.items).toEqual(before.items);
      await updateVaultSettings(database, "vault-owner", { items: [] });
      expect((await getVaultSettings(database, "vault-owner")).items).toEqual([]);
      expect(
        connectionDisplayName(await listConnectionNames(), "vault-owner", slug, "Fallback"),
      ).toBe("Durable label");
      await clearVaultSettings(database, "vault-owner");
      await saveBudaConnection(credential("vault-agent"));
      expect((await getAgentConnectionDetail(slug)).agentName).toBe("Durable label");
    });
  });
});
