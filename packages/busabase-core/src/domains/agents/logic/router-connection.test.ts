import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../../../context";
import { getDb } from "../../../db";
import { busabaseRouterConnections } from "../schema/router-enrollments";
import { busabaseRouterGrants } from "../schema/router-grants";
import {
  disconnectRouterConnection,
  listRouterConnections,
  resolveRouterConnectionLaunch,
} from "./router-connection";
import { mintRouterEnrollment, registerRouterConnection } from "./router-enrollment";
import { completeRouterOauth, startRouterOauth } from "./router-oauth";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../../../../apps/busabase");

const asActor = <T>(actorId: string, spaceId: string, fn: () => Promise<T>) =>
  runWithBusabaseContext({ actorId, spaceId }, fn);

describe("router-connection: resolveLaunch + disconnect", () => {
  let dataDir = "";
  let originalCwd = "";
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalOrigin = process.env.ACPROUTER_ENROLLMENT_ORIGIN;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-router-connection-db-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret";
    process.env.ACPROUTER_ENROLLMENT_ORIGIN = "https://acprouter.example";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
    if (originalOrigin === undefined) delete process.env.ACPROUTER_ENROLLMENT_ORIGIN;
    else process.env.ACPROUTER_ENROLLMENT_ORIGIN = originalOrigin;
    vi.unstubAllGlobals();
  });

  async function createConnectedAgent(
    actorId: string,
    spaceId: string,
    enrollmentId: string,
    agentSlug: string,
  ): Promise<string> {
    const { redirectUrl } = await asActor(actorId, spaceId, () =>
      startRouterOauth("https://busabase.example/callback"),
    );
    const signedState = new URL(redirectUrl).searchParams.get("state") as string;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const href = url.toString();
        if (href.includes("/api/oauth/token")) {
          return new Response(
            JSON.stringify({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }),
            { status: 200 },
          );
        }
        if (href.includes("/grant-info")) {
          return new Response(
            JSON.stringify({
              issuer: "https://acprouter.example",
              clientId: "busabase-cloud-enrollment",
              grantId: "remote-grant-1",
              userId: "remote-user-1",
              spaceId: "acp-space-1",
              spaceName: "Acme",
              role: "admin",
            }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );
    const { grantId } = await completeRouterOauth({
      signedState,
      code: "auth-code-1",
      redirectUri: "https://busabase.example/callback",
      currentActorId: actorId,
      isStillMemberOfFrozenSpace: async () => true,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              machineId: enrollmentId,
              enrollmentId,
              token: "t",
              command: "c",
              expiresAt: "2099-01-01T00:00:00.000Z",
            }),
            { status: 200 },
          ),
      ),
    );
    await asActor(actorId, spaceId, () => mintRouterEnrollment(grantId));

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              outcome: "registered",
              agentId: "agent-xyz",
              connectionUrl: `wss://acprouter.example/acp/${enrollmentId}`,
              key: { id: "key-1", label: "router" },
            }),
            { status: 200 },
          ),
      ),
    );
    const { connectionSlug } = await asActor(actorId, spaceId, () =>
      registerRouterConnection(grantId, enrollmentId, agentSlug),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    return connectionSlug;
  }

  it("resolves {url, authHeader} for a connected agent", async () => {
    const slug = await createConnectedAgent("usr_a", "space_a", "mach-a", "my-agent");

    const launch = await asActor("usr_a", "space_a", () => resolveRouterConnectionLaunch(slug));
    expect(launch.url).toBe("wss://acprouter.example/acp/mach-a");
    expect(launch.authHeader).toMatch(/^Bearer /);
  });

  it("does not expose another actor's device even inside the same workspace", async () => {
    const slug = await createConnectedAgent(
      "owner-only",
      "shared-space",
      "owner-device",
      "claude-acp",
    );
    await expect(
      asActor("other-member", "shared-space", () => resolveRouterConnectionLaunch(slug)),
    ).rejects.toThrow("not connected");
    expect(await asActor("other-member", "shared-space", () => listRouterConnections())).toEqual(
      [],
    );
  });

  it("lists two enrolled machines under one grant as two distinct connections", async () => {
    const slug1 = await createConnectedAgent("usr_b", "space_b", "mach-b1", "agent-one");
    const slug2 = await createConnectedAgent("usr_b", "space_b", "mach-b2", "agent-two");

    const connections = await asActor("usr_b", "space_b", () => listRouterConnections());
    const slugs = connections.map((c) => c.slug);
    expect(slugs).toContain(slug1);
    expect(slugs).toContain(slug2);
    expect(slug1).not.toBe(slug2);
  });

  it("deletes the vault row only after a successful revoke call, calling the device-scoped endpoint (not the whole-grant OAuth revoke)", async () => {
    const slug = await createConnectedAgent("usr_c", "space_c", "mach-c", "my-agent");
    const fetchSpy = vi.fn(
      async (_url: string | URL, _init?: RequestInit) => new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await asActor("usr_c", "space_c", () => disconnectRouterConnection(slug));
    expect(result).toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(calledUrl.toString()).toContain("/api/busabase-enrollment/device");
    expect(calledUrl.toString()).not.toContain("/api/oauth/revoke");
    expect(calledInit?.method).toBe("DELETE");

    await expect(
      asActor("usr_c", "space_c", () => resolveRouterConnectionLaunch(slug)),
    ).rejects.toThrow("not connected");
  });

  it("disconnecting one device leaves a sibling device under the same grant fully launchable", async () => {
    const slugA = await createConnectedAgent("usr_f", "space_f", "mach-f1", "agent-f1");
    // Mint a second device under the SAME grant by reusing the grant id the
    // first connection resolved to.
    const database = await getDb();
    const [connectionA] = await database
      .select()
      .from(busabaseRouterConnections)
      .where(eq(busabaseRouterConnections.acprouterEnrollmentId, "mach-f1"));
    if (!connectionA) throw new Error("expected connection A to exist");
    const grantId = connectionA.grantId;

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              machineId: "mach-f2",
              enrollmentId: "mach-f2",
              token: "t2",
              command: "c2",
              expiresAt: "2099-01-01T00:00:00.000Z",
            }),
            { status: 200 },
          ),
      ),
    );
    await asActor("usr_f", "space_f", () => mintRouterEnrollment(grantId));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              outcome: "registered",
              agentId: "agent-f2-xyz",
              connectionUrl: "wss://acprouter.example/acp/mach-f2",
              key: { id: "key-f2", label: "router" },
            }),
            { status: 200 },
          ),
      ),
    );
    const { connectionSlug: slugB } = await asActor("usr_f", "space_f", () =>
      registerRouterConnection(grantId, "mach-f2", "agent-f2"),
    );
    vi.unstubAllGlobals();

    expect(slugA).not.toBe(slugB);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const result = await asActor("usr_f", "space_f", () => disconnectRouterConnection(slugA));
    expect(result).toBe(true);
    vi.unstubAllGlobals();

    await expect(
      asActor("usr_f", "space_f", () => resolveRouterConnectionLaunch(slugA)),
    ).rejects.toThrow("not connected");

    // Sibling device B must remain fully launchable — a device-scoped
    // disconnect must never touch another device under the same grant.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const launchB = await asActor("usr_f", "space_f", () => resolveRouterConnectionLaunch(slugB));
    expect(launchB.url).toBe("wss://acprouter.example/acp/mach-f2");

    const connections = await asActor("usr_f", "space_f", () => listRouterConnections());
    expect(connections.map((c) => c.slug)).toEqual([slugB]);
  });

  it("blocks launch while a disconnect is pending, before the remote call resolves", async () => {
    const slug = await createConnectedAgent("usr_g", "space_g", "mach-g", "my-agent");
    let releaseRevoke: (() => void) | undefined;
    const pendingRevoke = new Promise<void>((resolve) => {
      releaseRevoke = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await pendingRevoke;
        return new Response(null, { status: 200 });
      }),
    );

    const disconnectPromise = asActor("usr_g", "space_g", () => disconnectRouterConnection(slug));

    // Yield so `disconnectRouterConnection`'s own `await database.update(...)`
    // (which sets `pendingRevokedAt` BEFORE the blocked network call) has a
    // chance to actually land before this check runs.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // While the remote call is still in flight, the connection must already
    // be unlaunchable — `pendingRevokedAt` is set BEFORE the network call.
    await expect(
      asActor("usr_g", "space_g", () => resolveRouterConnectionLaunch(slug)),
    ).rejects.toThrow("being disconnected");

    releaseRevoke?.();
    await disconnectPromise;
  });

  it("retains the pending-revoke marker and blocks launch after a failed disconnect", async () => {
    const slug = await createConnectedAgent("usr_h", "space_h", "mach-h", "my-agent");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );

    await expect(
      asActor("usr_h", "space_h", () => disconnectRouterConnection(slug)),
    ).rejects.toThrow("could not revoke");

    await expect(
      asActor("usr_h", "space_h", () => resolveRouterConnectionLaunch(slug)),
    ).rejects.toThrow("being disconnected");
  });

  it("blocks launch once the grant itself has been revoked", async () => {
    const slug = await createConnectedAgent("usr_i", "space_i", "mach-i", "my-agent");
    const database = await getDb();
    const [connection] = await database
      .select()
      .from(busabaseRouterConnections)
      .where(eq(busabaseRouterConnections.acprouterEnrollmentId, "mach-i"));
    if (!connection) throw new Error("expected connection to exist");
    await database
      .update(busabaseRouterGrants)
      .set({ revokedAt: new Date() })
      .where(eq(busabaseRouterGrants.id, connection.grantId));

    await expect(
      asActor("usr_i", "space_i", () => resolveRouterConnectionLaunch(slug)),
    ).rejects.toThrow("no longer authorized");
  });

  it("rejects a stored connection URL whose origin does not match the trusted ACPRouter origin", async () => {
    const slug = await createConnectedAgent("usr_j", "space_j", "mach-j", "my-agent");
    process.env.ACPROUTER_ENROLLMENT_ORIGIN = "https://a-different-acprouter.example";

    await expect(
      asActor("usr_j", "space_j", () => resolveRouterConnectionLaunch(slug)),
    ).rejects.toThrow("trusted origin");
  });

  it("keeps the connection intact when revoke fails", async () => {
    const slug = await createConnectedAgent("usr_d", "space_d", "mach-d", "my-agent");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );

    await expect(
      asActor("usr_d", "space_d", () => disconnectRouterConnection(slug)),
    ).rejects.toThrow("could not revoke");

    await expect(
      asActor("usr_d", "space_d", () => resolveRouterConnectionLaunch(slug)),
    ).rejects.toThrow("being disconnected");
  });

  it("does not call revoke or touch the vault when enrollment is config-disabled", async () => {
    const slug = await createConnectedAgent("usr_e", "space_e", "mach-e", "my-agent");
    delete process.env.ACPROUTER_ENROLLMENT_ORIGIN;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      asActor("usr_e", "space_e", () => disconnectRouterConnection(slug)),
    ).rejects.toThrow(/ACPROUTER_ENROLLMENT_ORIGIN/);
    expect(fetchSpy).not.toHaveBeenCalled();

    process.env.ACPROUTER_ENROLLMENT_ORIGIN = "https://acprouter.example";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const launch = await asActor("usr_e", "space_e", () => resolveRouterConnectionLaunch(slug));
    expect(launch.url).toBe("wss://acprouter.example/acp/mach-e");
  });
});
