import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../../../context";
import {
  cleanupAbandonedRouterEnrollments,
  mintRouterEnrollment,
  pollRouterEnrollmentStatus,
  registerRouterConnection,
} from "./router-enrollment";
import { completeRouterOauth, startRouterOauth } from "./router-oauth";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../../../../apps/busabase");

const asActor = <T>(actorId: string, spaceId: string, fn: () => Promise<T>) =>
  runWithBusabaseContext({ actorId, spaceId }, fn);

describe("router-enrollment: mint, poll, complete", () => {
  let dataDir = "";
  let originalCwd = "";
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalOrigin = process.env.ACPROUTER_ENROLLMENT_ORIGIN;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-router-enrollment-db-"));
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

  async function createGrant(actorId: string, spaceId: string): Promise<string> {
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
    vi.unstubAllGlobals();
    return grantId;
  }

  describe("mintRouterEnrollment", () => {
    it("rejects for a non-existent grant without calling ACPRouter", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      await expect(
        asActor("usr_a", "space_a", () => mintRouterEnrollment("rgr_does_not_exist")),
      ).rejects.toThrow("no longer authorized");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("mints a command and never logs the token or command", async () => {
      const grantId = await createGrant("usr_b", "space_b");
      const consoleLogSpy = vi.spyOn(console, "log");
      const consoleErrorSpy = vi.spyOn(console, "error");

      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                machineId: "mach-1",
                enrollmentId: "mach-1",
                token: "super-secret-token",
                command: "npx acprouter-cli enroll --token=super-secret-token",
                expiresAt: "2099-01-01T00:00:00.000Z",
              }),
              { status: 200 },
            ),
        ),
      );

      const result = await asActor("usr_b", "space_b", () => mintRouterEnrollment(grantId));
      expect(result.enrollmentId).toBe("mach-1");
      expect(result.command).toContain("super-secret-token");

      const loggedText = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
        .flat()
        .map((v) => String(v))
        .join(" ");
      expect(loggedText).not.toContain("super-secret-token");
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it("rejects mint attempts past the per-grant rate limit", async () => {
      const grantId = await createGrant("usr_c", "space_c");
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                machineId: "mach-x",
                enrollmentId: `mach-${Math.random()}`,
                token: "t",
                command: "c",
                expiresAt: "2099-01-01T00:00:00.000Z",
              }),
              { status: 200 },
            ),
        ),
      );

      for (let i = 0; i < 5; i++) {
        await asActor("usr_c", "space_c", () => mintRouterEnrollment(grantId));
      }
      await expect(
        asActor("usr_c", "space_c", () => mintRouterEnrollment(grantId)),
      ).rejects.toThrow("Too many enrollment attempts");
    });
  });

  describe("pollRouterEnrollmentStatus", () => {
    it.each(["not_redeemed", "redeemed_offline", "online", "failed"])(
      "maps the %s state",
      async (state) => {
        const grantId = await createGrant(`usr_poll_${state}`, `space_poll_${state}`);
        vi.stubGlobal(
          "fetch",
          vi.fn(
            async () =>
              new Response(
                JSON.stringify(
                  state === "not_redeemed" ? { state } : { state, machineId: "mach-1" },
                ),
                { status: 200 },
              ),
          ),
        );
        const result = await asActor(`usr_poll_${state}`, `space_poll_${state}`, () =>
          pollRouterEnrollmentStatus(grantId, "mach-1"),
        );
        expect(result.state).toBe(state);
      },
    );
  });

  describe("registerRouterConnection", () => {
    async function mintOne(actorId: string, spaceId: string, grantId: string) {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                machineId: "mach-complete-1",
                enrollmentId: "mach-complete-1",
                token: "t",
                command: "c",
                expiresAt: "2099-01-01T00:00:00.000Z",
              }),
              { status: 200 },
            ),
        ),
      );
      await asActor(actorId, spaceId, () => mintRouterEnrollment(grantId));
    }

    it("rejects completion before the enrollment is minted", async () => {
      const grantId = await createGrant("usr_d", "space_d");
      await expect(
        asActor("usr_d", "space_d", () =>
          registerRouterConnection(grantId, "never-minted", "my-agent"),
        ),
      ).rejects.toThrow("Start the enrollment");
    });

    it("rejects when the agent has not finished bridging (409)", async () => {
      const grantId = await createGrant("usr_e", "space_e");
      await mintOne("usr_e", "space_e", grantId);

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 409 })),
      );

      await expect(
        asActor("usr_e", "space_e", () =>
          registerRouterConnection(grantId, "mach-complete-1", "my-agent"),
        ),
      ).rejects.toThrow("not finished bridging");
    });

    it("registers once and a same-enrollment retry is idempotent (no second key/connection)", async () => {
      const grantId = await createGrant("usr_f", "space_f");
      await mintOne("usr_f", "space_f", grantId);

      let completeCalls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL) => {
          const href = url.toString();
          if (href.includes("/complete")) {
            completeCalls += 1;
            return new Response(
              JSON.stringify({
                outcome: completeCalls === 1 ? "registered" : "already_registered",
                agentId: "agent-xyz",
                connectionUrl: "wss://acprouter.example/acp/mach-complete-1",
                key: { id: "key-1", label: "router" },
              }),
              { status: 200 },
            );
          }
          if (href.includes("/activate"))
            return new Response(JSON.stringify({ outcome: "activated" }), { status: 200 });
          return new Response(null, { status: 404 });
        }),
      );

      const first = await asActor("usr_f", "space_f", () =>
        registerRouterConnection(grantId, "mach-complete-1", "my-agent"),
      );
      const second = await asActor("usr_f", "space_f", () =>
        registerRouterConnection(grantId, "mach-complete-1", "my-agent"),
      );

      expect(first.connectionSlug).toBe(second.connectionSlug);
      expect(first.agentSlug).toBe("my-agent");
    });

    it("sends the activation marker after a fresh registration commits locally", async () => {
      const grantId = await createGrant("usr_activate_1", "space_activate_1");
      await mintOne("usr_activate_1", "space_activate_1", grantId);

      const calledUrls: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL) => {
          const href = url.toString();
          calledUrls.push(href);
          if (href.includes("/complete")) {
            return new Response(
              JSON.stringify({
                outcome: "registered",
                agentId: "agent-xyz",
                connectionUrl: "wss://acprouter.example/acp/mach-complete-1",
                key: { id: "key-1", label: "router" },
              }),
              { status: 200 },
            );
          }
          if (href.includes("/activate")) {
            return new Response(JSON.stringify({ outcome: "activated" }), { status: 200 });
          }
          return new Response(null, { status: 404 });
        }),
      );

      await asActor("usr_activate_1", "space_activate_1", () =>
        registerRouterConnection(grantId, "mach-complete-1", "my-agent"),
      );

      expect(calledUrls.some((href) => href.includes("/activate"))).toBe(true);
    });

    it("re-sends the activation marker on a retry that hits the already-registered short-circuit, surviving a lost first activation response", async () => {
      const grantId = await createGrant("usr_activate_2", "space_activate_2");
      await mintOne("usr_activate_2", "space_activate_2", grantId);

      let activateCalls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL) => {
          const href = url.toString();
          if (href.includes("/complete")) {
            return new Response(
              JSON.stringify({
                outcome: "registered",
                agentId: "agent-xyz",
                connectionUrl: "wss://acprouter.example/acp/mach-complete-1",
                key: { id: "key-1", label: "router" },
              }),
              { status: 200 },
            );
          }
          if (href.includes("/activate")) {
            activateCalls += 1;
            // First call simulates the response being lost (network error);
            // the local connection row is already committed by this point.
            if (activateCalls === 1) throw new Error("simulated network loss");
            return new Response(JSON.stringify({ outcome: "activated" }), { status: 200 });
          }
          return new Response(null, { status: 404 });
        }),
      );

      await expect(
        asActor("usr_activate_2", "space_activate_2", () =>
          registerRouterConnection(grantId, "mach-complete-1", "my-agent"),
        ),
      ).rejects.toThrow("simulated network loss");
      const second = await asActor("usr_activate_2", "space_activate_2", () =>
        registerRouterConnection(grantId, "mach-complete-1", "my-agent"),
      );

      expect(second.connectionSlug).toMatch(/^acprouter:/);
      expect(activateCalls).toBe(2);
    });

    it("keeps pairing incomplete when the activation marker call fails outright", async () => {
      const grantId = await createGrant("usr_activate_3", "space_activate_3");
      await mintOne("usr_activate_3", "space_activate_3", grantId);

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL) => {
          const href = url.toString();
          if (href.includes("/complete")) {
            return new Response(
              JSON.stringify({
                outcome: "registered",
                agentId: "agent-xyz",
                connectionUrl: "wss://acprouter.example/acp/mach-complete-1",
                key: { id: "key-1", label: "router" },
              }),
              { status: 200 },
            );
          }
          if (href.includes("/activate")) throw new Error("simulated network loss");
          return new Response(null, { status: 404 });
        }),
      );

      await expect(
        asActor("usr_activate_3", "space_activate_3", () =>
          registerRouterConnection(grantId, "mach-complete-1", "my-agent"),
        ),
      ).rejects.toThrow("simulated network loss");
    });
  });

  describe("cleanupAbandonedRouterEnrollments", () => {
    it("abandons only enrollments past their bridge deadline, tombstoning not deleting", async () => {
      const grantId = await createGrant("usr_g", "space_g");
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                machineId: "mach-cleanup-1",
                enrollmentId: "mach-cleanup-1",
                token: "t",
                command: "c",
                expiresAt: "2099-01-01T00:00:00.000Z",
              }),
              { status: 200 },
            ),
        ),
      );
      await asActor("usr_g", "space_g", () => mintRouterEnrollment(grantId));

      // Not yet past the 10-minute deadline — must not be touched.
      const unaffected = await cleanupAbandonedRouterEnrollments(new Date());
      expect(unaffected).toBe(0);

      // 11 minutes later, the same row is abandoned.
      const past = new Date(Date.now() + 11 * 60 * 1000);
      const abandoned = await cleanupAbandonedRouterEnrollments(past);
      expect(abandoned).toBeGreaterThanOrEqual(1);
    });
  });
});
