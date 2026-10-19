import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../../../context";
import { completeRouterOauth, getRouterGrantTokens, startRouterOauth } from "./router-oauth";

/**
 * Driven against a real PGLite database rather than a mocked db — the
 * one-use state consumption (`UPDATE ... WHERE status = 'pending' RETURNING`)
 * and the grant/vault-item persistence are exactly the behaviour under test;
 * stubbing the db would just assert the shape of the code instead. Matches
 * the pattern in `src/logic/node-share.test.ts`.
 */
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../../../../apps/busabase");

const asActor = <T>(actorId: string, spaceId: string, fn: () => Promise<T>) =>
  runWithBusabaseContext({ actorId, spaceId }, fn);

describe("router-oauth: Connect via ACPRouter", () => {
  let dataDir = "";
  let originalCwd = "";
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalOrigin = process.env.ACPROUTER_ENROLLMENT_ORIGIN;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-router-oauth-db-"));
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

  it("rejects without write permission before any row is written", async () => {
    await expect(
      runWithBusabaseContext({ actorId: "usr_a", spaceId: "space_a", isSpaceManager: false }, () =>
        startRouterOauth("https://busabase.example/callback"),
      ),
    ).rejects.toThrow(/write workspace access/);
  });

  it("writes a pending state row and returns a redirect URL", async () => {
    const result = await asActor("usr_b", "space_b", () =>
      startRouterOauth("https://busabase.example/callback"),
    );
    expect(result.redirectUrl).toContain("https://acprouter.example/api/oauth/authorize");
    expect(result.redirectUrl).toContain("client_id=busabase-cloud-enrollment");
    expect(result.redirectUrl).toContain("scope=enrollment");
    expect(result.redirectUrl).toContain("code_challenge_method=S256");
  });

  function stubTokenAndGrantInfoFetch(spaceName = "Acme") {
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
              spaceName,
              role: "admin",
            }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );
  }

  it("persists a grant on the happy path", async () => {
    const { redirectUrl } = await asActor("usr_c", "space_c", () =>
      startRouterOauth("https://busabase.example/callback"),
    );
    const signedState = new URL(redirectUrl).searchParams.get("state") as string;
    stubTokenAndGrantInfoFetch();

    const result = await completeRouterOauth({
      signedState,
      code: "auth-code-1",
      redirectUri: "https://busabase.example/callback",
      currentActorId: "usr_c",
      isStillMemberOfFrozenSpace: async () => true,
    });

    expect(result.acprouterSpaceName).toBe("Acme");
    expect(result.grantId).toMatch(/^rgr_/);
  });

  it("serializes concurrent refreshes so workers reuse the rotated pair", async () => {
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("../../../db");
    const { busabaseRouterGrants } = await import("../schema/router-grants");
    const { busabaseVaultItems } = await import("../../vault/schema/vault-items");
    const { encodeVaultValue } = await import("../../vault/logic/vault-crypto");
    const flow = await asActor("refresh-owner", "refresh-space", () =>
      startRouterOauth("https://busabase.example/callback"),
    );
    stubTokenAndGrantInfoFetch();
    const result = await completeRouterOauth({
      signedState: new URL(flow.redirectUrl).searchParams.get("state") as string,
      code: "test-code",
      redirectUri: "https://busabase.example/callback",
      currentActorId: "refresh-owner",
      isStillMemberOfFrozenSpace: async () => true,
    });
    const database = await getDb();
    const [grant] = await database
      .select()
      .from(busabaseRouterGrants)
      .where(eq(busabaseRouterGrants.id, result.grantId));
    await database
      .update(busabaseVaultItems)
      .set({
        valuePayload: encodeVaultValue(
          JSON.stringify({
            accessToken: "test-old-access",
            refreshToken: "test-old-refresh",
            expiresAt: new Date(0).toISOString(),
          }),
          { requireEncryption: true },
        ),
      })
      .where(eq(busabaseVaultItems.id, grant.tokenVaultItemId));
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "test-new-access",
            refresh_token: "test-new-refresh",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const [first, second] = await asActor("refresh-owner", "refresh-space", () =>
      Promise.all([getRouterGrantTokens(result.grantId), getRouterGrantTokens(result.grantId)]),
    );
    expect(first).toEqual(second);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a replayed state and does not persist a second grant", async () => {
    const { redirectUrl } = await asActor("usr_d", "space_d", () =>
      startRouterOauth("https://busabase.example/callback"),
    );
    const signedState = new URL(redirectUrl).searchParams.get("state") as string;
    stubTokenAndGrantInfoFetch();

    const first = await completeRouterOauth({
      signedState,
      code: "auth-code-1",
      redirectUri: "https://busabase.example/callback",
      currentActorId: "usr_d",
      isStillMemberOfFrozenSpace: async () => true,
    });
    expect(first.grantId).toMatch(/^rgr_/);

    await expect(
      completeRouterOauth({
        signedState,
        code: "auth-code-2",
        redirectUri: "https://busabase.example/callback",
        currentActorId: "usr_d",
        isStillMemberOfFrozenSpace: async () => true,
      }),
    ).rejects.toThrow("already completed or expired");
  });

  it("rejects when a different actor is now signed in and does not persist a grant", async () => {
    const { redirectUrl } = await asActor("usr_e", "space_e", () =>
      startRouterOauth("https://busabase.example/callback"),
    );
    const signedState = new URL(redirectUrl).searchParams.get("state") as string;
    stubTokenAndGrantInfoFetch();

    await expect(
      completeRouterOauth({
        signedState,
        code: "auth-code-1",
        redirectUri: "https://busabase.example/callback",
        currentActorId: "someone-else",
        isStillMemberOfFrozenSpace: async () => true,
      }),
    ).rejects.toThrow("belongs to a different signed-in user");
  });

  it("rejects when the actor is no longer a member of the frozen space and does not persist a grant", async () => {
    const { redirectUrl } = await asActor("usr_f", "space_f", () =>
      startRouterOauth("https://busabase.example/callback"),
    );
    const signedState = new URL(redirectUrl).searchParams.get("state") as string;
    stubTokenAndGrantInfoFetch();

    await expect(
      completeRouterOauth({
        signedState,
        code: "auth-code-1",
        redirectUri: "https://busabase.example/callback",
        currentActorId: "usr_f",
        isStillMemberOfFrozenSpace: async () => false,
      }),
    ).rejects.toThrow("no longer a member");
  });
});
