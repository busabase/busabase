import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteCount: 0,
  rows: [] as Array<Record<string, unknown>>,
  nextId: 0,
}));

vi.mock("openlib/nanoid", () => ({
  generateNanoID: () => `vlt_test_${++mocks.nextId}`,
}));
vi.mock("../../../context", () => ({
  getContextActorId: () => "actor-1",
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

import { disconnectBuda, listBudaConnections, saveBudaConnection } from "./buda-connection";

const storedConnection = (agentId: string, agentName: string) => ({
  accessToken: `access-${agentId}`,
  refreshToken: `refresh-${agentId}`,
  expiresAt: "2099-01-01T00:00:00.000Z",
  agentId,
  agentName,
});

describe("Buda connection storage", () => {
  beforeEach(() => {
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
      { slug: "buda:agent-1", agentId: "agent-1", agentName: "Rex" },
      { slug: "buda:agent-2", agentId: "agent-2", agentName: "Ada" },
    ]);
    expect(mocks.rows).toEqual([
      expect.objectContaining({
        key: "BUDA_ACP_CONNECTION:agent-1",
        access: { runtime: false, reveal: false, edit: false, share: false },
      }),
      expect.objectContaining({
        key: "BUDA_ACP_CONNECTION:agent-2",
        access: { runtime: false, reveal: false, edit: false, share: false },
      }),
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
