/**
 * The Cloud half of the local-agent gate.
 *
 * This lives in its own file because the gate turns on `getContextActorId()`,
 * which is mocked per-module — the sibling `agent-catalog.test.ts` pins it to
 * `undefined` (the OSS/desktop host) for every case in it.
 *
 * It exists because that asymmetry is what went wrong: local agents were
 * disabled everywhere with a blanket `comingSoon` flag, when only Cloud was
 * meant to be blocked. Nothing asserted the Cloud side, so nothing noticed the
 * OSS side had been taken with it. These are the assertions that make the two
 * hosts differ on purpose rather than by accident.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(() => ({ status: 0 })),
  listBudaConnections: vi.fn(async () => []),
  getBudaConnection: vi.fn(async () => undefined),
}));

vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }));
// A non-undefined actor id IS the Cloud host detector — see isCloudHost().
vi.mock("../../../context", () => ({ getContextActorId: () => "actor-1" }));
vi.mock("./buda-connection", () => ({
  getBudaAcpUrl: (agentId: string) => `wss://buda.example/api/acp?agentId=${agentId}`,
  getBudaConnection: mocks.getBudaConnection,
  listBudaConnections: mocks.listBudaConnections,
}));

import { listCatalog, resolveLaunch } from "./agent-catalog";

describe("local agents on the Cloud host", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ agents: [] }), { status: 200 })),
    );
  });

  it("offers neither local agent, and explains why", async () => {
    const catalog = await listCatalog();

    for (const slug of ["claude-acp", "codex-acp"]) {
      expect(catalog.find((entry) => entry.slug === slug)).toMatchObject({
        available: false,
        unavailableReason: expect.stringContaining("run on your own machine"),
      });
    }
  });

  it("does not probe Cloud's own PATH", async () => {
    await listCatalog();
    // Whether Cloud's server has npx says nothing about the user's machine,
    // and probing it would make the reason shown depend on Cloud's image.
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });

  /**
   * The gate that actually matters. `listCatalog` only decides what the UI
   * offers; a caller that skips the UI — a stale client, or a direct RPC —
   * must still be refused, or Cloud would spawn a subprocess in a shared
   * multi-tenant process.
   */
  it("refuses a direct launch even when the catalog is bypassed", async () => {
    await expect(resolveLaunch("codex-acp")).rejects.toThrow(/own machine/);
    await expect(resolveLaunch("claude-acp")).rejects.toThrow(/own machine/);
  });
});
