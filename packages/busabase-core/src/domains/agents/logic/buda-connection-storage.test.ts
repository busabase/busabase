import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actorId: "actor-1",
  deleteCount: 0,
  rows: [] as Array<Record<string, unknown>>,
  nextId: 0,
}));

vi.mock("openlib/nanoid", () => ({
  generateNanoID: () => `vlt_test_${++mocks.nextId}`,
}));
vi.mock("../../../context", () => ({
  getContextActorId: () => mocks.actorId,
  getContextSpaceId: () => "space-1",
}));
vi.mock("../../vault/logic/vault-crypto", () => ({
  encodeVaultValue: (value: string) => ({ version: 1, encoding: "plain", value }),
  decodeVaultValue: (payload: { value: string }) => payload.value,
}));
vi.mock("../../../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: async () => mocks.rows,
      }),
    }),
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        mocks.rows.push(value);
      },
    }),
    delete: () => ({
      where: async () => {
        mocks.deleteCount += 1;
      },
    }),
  }),
}));

import {
  disconnectBuda,
  getBudaConnection,
  listBudaConnections,
  saveBudaConnection,
} from "./buda-connection";

const storedConnection = (agentId: string, agentName: string) => ({
  accessToken: `access-${agentId}`,
  refreshToken: `refresh-${agentId}`,
  expiresAt: "2099-01-01T00:00:00.000Z",
  agentId,
  agentName,
});

describe("Buda connection storage", () => {
  beforeEach(() => {
    mocks.actorId = "actor-1";
    mocks.deleteCount = 0;
    mocks.rows.length = 0;
    mocks.nextId = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
  });

  it("stores separate grants for separate Buda agents", async () => {
    await expect(saveBudaConnection(storedConnection("agent-1", "Rex"))).resolves.toBe(
      "buda:agent-1",
    );
    await expect(saveBudaConnection(storedConnection("agent-2", "Ada"))).resolves.toBe(
      "buda:agent-2",
    );

    await expect(listBudaConnections()).resolves.toEqual([
      {
        slug: "buda:agent-1",
        agentId: "agent-1",
        agentName: "Rex",
        ownedByCurrentUser: true,
      },
      {
        slug: "buda:agent-2",
        agentId: "agent-2",
        agentName: "Ada",
        ownedByCurrentUser: true,
      },
    ]);
    expect(mocks.rows).toEqual([
      expect.objectContaining({
        key: "BUDA_ACP_CONNECTION:agent-1",
        access: { runtime: false, reveal: false, edit: false, share: true },
      }),
      expect.objectContaining({
        key: "BUDA_ACP_CONNECTION:agent-2",
        access: { runtime: false, reveal: false, edit: false, share: true },
      }),
    ]);
  });

  it("lists and resolves connections shared by another member in the same space", async () => {
    await saveBudaConnection(storedConnection("agent-1", "Rex"));
    mocks.actorId = "actor-2";
    await saveBudaConnection(storedConnection("agent-2", "Ada"));
    mocks.actorId = "actor-1";

    await expect(listBudaConnections("mine")).resolves.toEqual([
      {
        slug: "buda:agent-1",
        agentId: "agent-1",
        agentName: "Rex",
        ownedByCurrentUser: true,
      },
    ]);
    await expect(listBudaConnections("space")).resolves.toEqual([
      {
        slug: "buda:agent-1",
        agentId: "agent-1",
        agentName: "Rex",
        ownedByCurrentUser: true,
      },
      {
        slug: "buda:agent-2",
        agentId: "agent-2",
        agentName: "Ada",
        ownedByCurrentUser: false,
      },
    ]);
    await expect(getBudaConnection("buda:agent-2")).resolves.toMatchObject({
      slug: "buda:agent-2",
      agentId: "agent-2",
      agentName: "Ada",
      accessToken: "access-agent-2",
    });
  });

  it("does not let a member disconnect another member's shared connection", async () => {
    mocks.actorId = "actor-2";
    await saveBudaConnection(storedConnection("agent-2", "Ada"));
    mocks.actorId = "actor-1";

    await expect(disconnectBuda("buda:agent-2")).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.deleteCount).toBe(0);
  });

  it("keeps another member's connection visible when both connected the same agent", async () => {
    await saveBudaConnection({
      ...storedConnection("agent-1", "Nimbus"),
      refreshToken: "refresh-actor-1",
    });
    mocks.actorId = "actor-2";
    await saveBudaConnection({
      ...storedConnection("agent-1", "Nimbus"),
      refreshToken: "refresh-actor-2",
    });
    mocks.actorId = "actor-1";

    await expect(listBudaConnections("space")).resolves.toEqual([
      {
        slug: "buda:agent-1",
        agentId: "agent-1",
        agentName: "Nimbus",
        ownedByCurrentUser: true,
      },
    ]);

    await expect(disconnectBuda("buda:agent-1")).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://dev.buda.im/api/oauth/revoke"),
      expect.objectContaining({
        body: new URLSearchParams({
          token: "refresh-actor-1",
          token_type_hint: "refresh_token",
          client_id: "busabase-cloud",
        }),
      }),
    );

    // The test DB records delete calls but does not interpret Drizzle predicates.
    // Mirror the confirmed owner-row deletion so the follow-up list assertion
    // exercises the remaining member's visibility.
    const deletedOwnerRow = mocks.rows.findIndex(
      (row) => row.userId === "actor-1" && row.key === "BUDA_ACP_CONNECTION:agent-1",
    );
    expect(deletedOwnerRow).toBeGreaterThanOrEqual(0);
    mocks.rows.splice(deletedOwnerRow, 1);

    await expect(listBudaConnections("space")).resolves.toEqual([
      {
        slug: "buda:agent-1",
        agentId: "agent-1",
        agentName: "Nimbus",
        ownedByCurrentUser: false,
      },
    ]);
  });

  it("revokes the token family selected by a multi-agent slug before deletion", async () => {
    await saveBudaConnection(storedConnection("agent-1", "Rex"));
    await saveBudaConnection(storedConnection("agent-2", "Ada"));

    await expect(disconnectBuda("buda:agent-2")).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledWith(
      new URL("https://dev.buda.im/api/oauth/revoke"),
      expect.objectContaining({
        method: "POST",
        body: new URLSearchParams({
          token: "refresh-agent-2",
          token_type_hint: "refresh_token",
          client_id: "busabase-cloud",
        }),
      }),
    );
    expect(mocks.deleteCount).toBe(1);
  });

  it("keeps the saved credential when Buda revocation fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await saveBudaConnection(storedConnection("agent-1", "Rex"));

    await expect(disconnectBuda("buda:agent-1")).rejects.toThrow(
      "Buda could not revoke this connection. Try again.",
    );

    expect(mocks.deleteCount).toBe(0);
  });
});
