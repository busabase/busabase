import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { MAX_WEBHOOK_RULES_PER_SPACE } from "../src/domains/webhook/logic/webhook-logic";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * The `webhook` domain: rules that fire on space/base events (`record.created`,
 * `ai_mention`, `changes_requested`) via a signed HTTP POST, the `notify_agent`
 * generalization of the old hardcoded agent webhook, or a sandboxed
 * `run_snippet` action. Covers CRUD, dispatch on real events (record merge / an
 * `@ai` mention), the secret round-trip on update, scoping (disabled / base),
 * the QuickJS sandbox's isolation + timeout, and input validation.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

type Hit = { path: string; body: string; signature: string | null };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `predicate()` is true or `timeoutMs` elapses — avoids flaky fixed sleeps. */
const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 25,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
};

describe("Webhook automation domain — oRPC", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let blogBaseId = "";
  let socialBaseId = "";
  let server: ReturnType<typeof createServer>;
  let port = 0;
  let received: Hit[] = [];
  // A SECOND local listener, also on 127.0.0.1, deliberately kept OUT of the
  // SSRF-guard test allowlist below — used to prove the SSRF tests block
  // delivery BEFORE any connection is attempted (if the guard didn't block,
  // this real, working listener would receive the request, same as `server`
  // does for every other test in this file).
  let ssrfProbeServer: ReturnType<typeof createServer>;
  let ssrfProbePort = 0;
  let ssrfProbeReceived: Hit[] = [];

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-webhook-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-webhook-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    process.env.BUSABASE_VAULT_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd";

    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        received.push({
          path: req.url ?? "",
          body: Buffer.concat(chunks).toString("utf8"),
          signature: (req.headers["x-busabase-signature"] as string) ?? null,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;

    ssrfProbeServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        ssrfProbeReceived.push({
          path: req.url ?? "",
          body: Buffer.concat(chunks).toString("utf8"),
          signature: (req.headers["x-busabase-signature"] as string) ?? null,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => ssrfProbeServer.listen(0, "127.0.0.1", resolve));
    ssrfProbePort = (ssrfProbeServer.address() as { port: number }).port;

    // The SSRF guard added to dispatch.ts (see dispatch.ts's "SSRF guard"
    // section) blocks loopback targets like 127.0.0.1 — which is exactly
    // where `server` above lives, and which every pre-existing test in this
    // file legitimately dispatches to. Rather than weakening the guard, opt
    // THIS EXACT host:port into a narrowly-scoped, test-only allowlist that
    // dispatch.ts only honors when Vitest itself has set `VITEST` (never
    // true in production) — see `isTestAllowlistedTarget` in dispatch.ts.
    // `ssrfProbePort` above is deliberately NOT included, so the "SSRF
    // protection" tests below still prove the block is real.
    process.env.BUSABASE_WEBHOOK_TEST_ALLOW_TARGETS = `127.0.0.1:${port}`;

    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
    const bases = await client.bases.list();
    blogBaseId = bases.find((base) => base.slug === "blog")?.id ?? "";
    socialBaseId = bases.find((base) => base.slug === "social-content")?.id ?? "";
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => ssrfProbeServer.close(resolve));
    delete process.env.BUSABASE_WEBHOOK_TEST_ALLOW_TARGETS;
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    delete process.env.BUSABASE_VAULT_ENCRYPTION_KEY;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const hookUrl = (route: string) => `http://127.0.0.1:${port}/${route}`;

  const createAndMergeRecord = async (baseId: string, title: string) => {
    const cr = await client.bases.createChangeRequest({
      baseId,
      fields: { title, body: "v1", channel: "blog" },
      message: "Initial",
      submittedBy: "webhook-test",
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });
    return cr;
  };

  const waitForHit = (route: string, timeoutMs = 2000) =>
    waitFor(() => received.some((hit) => hit.path === `/${route}`), timeoutMs);

  // ── CRUD ───────────────────────────────────────────────────────────────────

  describe("CRUD", () => {
    it("creates, lists, gets, updates, and deletes a rule", async () => {
      const created = await client.webhooks.create({
        name: "crud rule",
        eventType: "record.created",
        baseId: null,
        actionKind: "webhook",
        config: { targetUrl: hookUrl("crud") },
        enabled: true,
      });
      expect(created.name).toBe("crud rule");

      const listed = await client.webhooks.list();
      expect(listed.some((rule) => rule.id === created.id)).toBe(true);

      const fetched = await client.webhooks.get({ id: created.id });
      expect(fetched.id).toBe(created.id);

      const updated = await client.webhooks.update({
        id: created.id,
        name: "crud rule renamed",
        eventType: "record.created",
        baseId: null,
        actionKind: "webhook",
        config: { targetUrl: hookUrl("crud-2") },
        enabled: false,
      });
      expect(updated.name).toBe("crud rule renamed");
      expect(updated.enabled).toBe(false);
      if (updated.actionKind === "webhook") {
        expect(updated.config.targetUrl).toBe(hookUrl("crud-2"));
      }

      const refetched = await client.webhooks.get({ id: created.id });
      expect(refetched.name).toBe("crud rule renamed");
      expect(refetched.enabled).toBe(false);

      const deleteResult = await client.webhooks.delete({ id: created.id });
      expect(deleteResult.success).toBe(true);
      const listedAfterDelete = await client.webhooks.list();
      expect(listedAfterDelete.some((rule) => rule.id === created.id)).toBe(false);
    });

    it("rejects malformed input at the oRPC input-validation boundary", async () => {
      await expect(
        client.webhooks.create({
          name: "bad url",
          eventType: "record.created",
          baseId: null,
          actionKind: "webhook",
          // Not a URL — WebhookHttpConfigSchema requires z.string().url().
          config: { targetUrl: "not-a-url" },
          enabled: true,
        }),
      ).rejects.toThrow();

      await expect(
        client.webhooks.create({
          // Missing required `name`.
          eventType: "record.created",
          baseId: null,
          actionKind: "webhook",
          config: { targetUrl: hookUrl("never") },
          enabled: true,
          // biome-ignore lint/suspicious/noExplicitAny: intentionally malformed input for the validation test
        } as any),
      ).rejects.toThrow();
    });
  });

  // ── Dispatch ───────────────────────────────────────────────────────────────

  describe("dispatch", () => {
    it("fires a signed POST to a webhook rule when a record is created via CR merge", async () => {
      received = [];
      const rule = await client.webhooks.create({
        name: "test record.created",
        eventType: "record.created",
        baseId: null,
        actionKind: "webhook",
        config: { targetUrl: hookUrl("hook"), secret: "s3cr3t" },
        enabled: true,
      });
      expect(rule.config).not.toHaveProperty("secret");

      await createAndMergeRecord(blogBaseId, "Webhook smoke test");
      expect(await waitForHit("hook")).toBe(true);

      const hit = received.find((r) => r.path === "/hook");
      const parsed = JSON.parse(hit!.body);
      expect(parsed.event).toBe("record.created");
      expect(parsed.fields.title).toBe("Webhook smoke test");
      const expectedSig = createHmac("sha256", "s3cr3t").update(hit!.body).digest("hex");
      expect(hit!.signature).toBe(expectedSig);

      const deliveries = await client.webhooks.deliveries({ ruleId: rule.id, limit: 10 });
      expect(deliveries[0]?.status).toBe("success");
    });

    it("notify_agent replaces the old env-var push for @ai mentions", async () => {
      received = [];
      await client.webhooks.create({
        name: "test ai_mention",
        eventType: "ai_mention",
        baseId: null,
        actionKind: "notify_agent",
        config: { targetUrl: hookUrl("agent-hook") },
        enabled: true,
      });

      const cr = await client.bases.createChangeRequest({
        baseId: blogBaseId,
        fields: { title: "Needs AI", body: "v1", channel: "blog" },
        message: "Initial",
        submittedBy: "webhook-test",
      });
      await client.comments.create({
        subjectType: "change_request",
        subjectId: cr.id,
        body: "@ai please help",
        mentionsAi: true,
      });
      expect(await waitForHit("agent-hook")).toBe(true);

      const hit = received.find((r) => r.path === "/agent-hook");
      const parsed = JSON.parse(hit!.body);
      expect(parsed.trigger).toBe("ai_mention");
      expect(parsed.changeRequestId).toBe(cr.id);
    });

    it("run_snippet computes a call spec in-sandbox and the host performs the one HTTP call", async () => {
      received = [];
      await client.webhooks.create({
        name: "test snippet",
        eventType: "record.created",
        baseId: null,
        actionKind: "run_snippet",
        config: {
          code: `console.log("hello from sandbox", input.recordId); return { url: ${JSON.stringify(hookUrl("snippet-hook"))}, method: "POST", body: { title: input.fields.title } };`,
          timeoutMs: 1000,
        },
        enabled: true,
      });

      await createAndMergeRecord(blogBaseId, "Snippet test");
      expect(await waitForHit("snippet-hook")).toBe(true);

      const hit = received.find((r) => r.path === "/snippet-hook");
      const parsed = JSON.parse(hit!.body);
      expect(parsed.title).toBe("Snippet test");
    });

    it("does not fire a disabled rule", async () => {
      received = [];
      await client.webhooks.create({
        name: "test disabled",
        eventType: "record.created",
        baseId: null,
        actionKind: "webhook",
        config: { targetUrl: hookUrl("disabled-hook") },
        enabled: false,
      });

      await createAndMergeRecord(blogBaseId, "Should not fire");
      // Give any (wrongly) in-flight dispatch a real chance to land, then assert
      // nothing arrived — this is the negative-space equivalent of waitForHit.
      await sleep(500);
      expect(received.some((r) => r.path === "/disabled-hook")).toBe(false);
    });

    it("a base-scoped rule only fires for its own base", async () => {
      received = [];
      expect(blogBaseId).not.toBe("");
      expect(socialBaseId).not.toBe("");

      await client.webhooks.create({
        name: "test base-scoped",
        eventType: "record.created",
        baseId: blogBaseId,
        actionKind: "webhook",
        config: { targetUrl: hookUrl("base-scoped-hook") },
        enabled: true,
      });

      // Different base — must NOT fire.
      await createAndMergeRecord(socialBaseId, "Wrong base");
      await sleep(500);
      expect(received.some((r) => r.path === "/base-scoped-hook")).toBe(false);

      // Matching base — must fire.
      await createAndMergeRecord(blogBaseId, "Right base");
      expect(await waitForHit("base-scoped-hook")).toBe(true);
    });

    it("retries a failing HTTP delivery with backoff before recording a failure", async () => {
      received = [];
      // Bind then immediately close a server to get a port that reliably
      // refuses every connection attempt (no full 5s HTTP_DELIVERY_TIMEOUT_MS
      // wait per attempt — ECONNREFUSED is near-instant).
      const deadServer = createServer();
      await new Promise<void>((resolve) => deadServer.listen(0, "127.0.0.1", resolve));
      const deadPort = (deadServer.address() as { port: number }).port;
      await new Promise((resolve) => deadServer.close(resolve));
      // This test targets a fresh 127.0.0.1 port (to get a reliable, near-
      // instant ECONNREFUSED) that's unrelated to the SSRF guard this test
      // isn't exercising — opt it into the same test-only allowlist as
      // `server`'s port so the guard doesn't short-circuit before the
      // connection-refused retry behavior under test even gets a chance to run.
      process.env.BUSABASE_WEBHOOK_TEST_ALLOW_TARGETS = `${process.env.BUSABASE_WEBHOOK_TEST_ALLOW_TARGETS},127.0.0.1:${deadPort}`;

      const rule = await client.webhooks.create({
        name: "test retry backoff",
        eventType: "record.created",
        baseId: null,
        actionKind: "webhook",
        config: { targetUrl: `http://127.0.0.1:${deadPort}/unreachable` },
        enabled: true,
      });

      const startedAt = Date.now();
      await createAndMergeRecord(blogBaseId, "Retry backoff test");

      const settled = await waitFor(async () => {
        const deliveries = await client.webhooks.deliveries({ ruleId: rule.id, limit: 5 });
        return deliveries.length > 0;
      }, 5000);
      expect(settled, "expected a delivery to be recorded within the bounded wait").toBe(true);

      // 3 total attempts means 2 backoff waits (250ms + 750ms = 1000ms)
      // elapsed before the final attempt's outcome got recorded.
      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeGreaterThanOrEqual(900);

      const deliveries = await client.webhooks.deliveries({ ruleId: rule.id, limit: 5 });
      expect(deliveries[0]?.status).toBe("failed");
      expect(deliveries[0]?.detail).toContain("after 3 attempts");
    });
  });

  // ── SSRF protection ────────────────────────────────────────────────────────
  //
  // dispatch.ts's `checkUrlIsSafeToFetch` guard must block a rule's
  // `targetUrl` before ANY connection attempt when it points at a
  // loopback/link-local/private address — a security fix for a real SSRF
  // vulnerability (a low-privileged space member could otherwise point a
  // rule at cloud metadata or an internal host and read the response back
  // via the delivery log). `ssrfProbeServer`/`ssrfProbePort` (bound to
  // 127.0.0.1, real and listening, deliberately NOT in the test allowlist)
  // exist so these tests can prove the block happens BEFORE any connection —
  // not just that it eventually fails for some unrelated reason.

  describe("SSRF protection", () => {
    it("blocks a rule targeting a loopback address before any connection is attempted", async () => {
      ssrfProbeReceived = [];
      const rule = await client.webhooks.create({
        name: "test ssrf loopback",
        eventType: "record.created",
        baseId: null,
        actionKind: "webhook",
        config: { targetUrl: `http://127.0.0.1:${ssrfProbePort}/ssrf-loopback` },
        enabled: true,
      });

      const startedAt = Date.now();
      await createAndMergeRecord(blogBaseId, "SSRF loopback test");

      const settled = await waitFor(async () => {
        const deliveries = await client.webhooks.deliveries({ ruleId: rule.id, limit: 5 });
        return deliveries.length > 0;
      }, 2000);
      expect(settled, "expected a delivery to be recorded within the bounded wait").toBe(true);

      // Fail-fast: blocked before the retry loop's backoff sleeps ever run
      // (contrast with the "retries a failing HTTP delivery" test above,
      // which takes >= 900ms for the very same reason it DOESN'T hit this
      // guard).
      expect(Date.now() - startedAt).toBeLessThan(900);

      const deliveries = await client.webhooks.deliveries({ ruleId: rule.id, limit: 5 });
      expect(deliveries[0]?.status).toBe("failed");
      expect(deliveries[0]?.detail?.toLowerCase()).toContain("blocked");

      // The decisive assertion: `ssrfProbeServer` is real, listening on this
      // exact 127.0.0.1:port/path, and would have recorded a hit had the
      // request actually been sent — it didn't, proving the guard rejected
      // the target BEFORE attempting a connection, not that the connection
      // was merely refused or timed out.
      expect(ssrfProbeReceived.some((hit) => hit.path === "/ssrf-loopback")).toBe(false);
    });

    it("blocks a rule targeting the cloud metadata IP literal before any connection is attempted", async () => {
      const rule = await client.webhooks.create({
        name: "test ssrf metadata",
        eventType: "record.created",
        baseId: null,
        actionKind: "webhook",
        config: { targetUrl: "http://169.254.169.254/latest/meta-data/" },
        enabled: true,
      });

      const startedAt = Date.now();
      await createAndMergeRecord(blogBaseId, "SSRF metadata test");

      const settled = await waitFor(async () => {
        const deliveries = await client.webhooks.deliveries({ ruleId: rule.id, limit: 5 });
        return deliveries.length > 0;
      }, 2000);
      expect(settled, "expected a delivery to be recorded within the bounded wait").toBe(true);

      // Blocked purely from the IP-literal range check — no DNS round-trip
      // and no network attempt to the (possibly reachable, possibly not,
      // depending on environment) real metadata endpoint, so this resolves
      // fast and deterministically in CI/sandboxed environments too.
      expect(Date.now() - startedAt).toBeLessThan(900);

      const deliveries = await client.webhooks.deliveries({ ruleId: rule.id, limit: 5 });
      expect(deliveries[0]?.status).toBe("failed");
      expect(deliveries[0]?.detail?.toLowerCase()).toContain("blocked");
    });
  });

  // ── Secret handling ────────────────────────────────────────────────────────

  describe("secret handling", () => {
    it("preserves the original secret when update omits it (the frontend toggle contract)", async () => {
      received = [];
      const rule = await client.webhooks.create({
        name: "test secret roundtrip",
        eventType: "record.created",
        baseId: null,
        actionKind: "webhook",
        config: { targetUrl: hookUrl("secret-hook"), secret: "original-secret" },
        enabled: true,
      });

      // Toggle `enabled` without resending `secret` — exactly what the
      // frontend's enable/disable switch does.
      await client.webhooks.update({
        id: rule.id,
        name: rule.name,
        eventType: rule.eventType,
        baseId: rule.baseId,
        actionKind: "webhook",
        config: { targetUrl: hookUrl("secret-hook") },
        enabled: true,
      });

      await createAndMergeRecord(blogBaseId, "Secret roundtrip test");
      expect(await waitForHit("secret-hook")).toBe(true);

      const hit = received.find((r) => r.path === "/secret-hook");
      const expectedSig = createHmac("sha256", "original-secret").update(hit!.body).digest("hex");
      expect(hit!.signature).toBe(expectedSig);
    });
  });

  // ── Sandbox ────────────────────────────────────────────────────────────────

  describe("run_snippet sandbox", () => {
    it("cannot reach fetch/require/process", async () => {
      received = [];
      await client.webhooks.create({
        name: "test sandbox escape",
        eventType: "record.created",
        baseId: null,
        actionKind: "run_snippet",
        config: {
          code: `console.log("types:", typeof fetch, typeof require, typeof process); return null;`,
          timeoutMs: 1000,
        },
        enabled: true,
      });

      await createAndMergeRecord(blogBaseId, "Escape test");

      const rules = await client.webhooks.list();
      const escapeRule = rules.find((r) => r.name === "test sandbox escape");
      await waitFor(async () => {
        const deliveries = await client.webhooks.deliveries({ ruleId: escapeRule!.id, limit: 5 });
        return deliveries.length > 0;
      }, 2000);
      const deliveries = await client.webhooks.deliveries({ ruleId: escapeRule!.id, limit: 5 });
      expect(deliveries[0]?.status).toBe("success");
      expect(deliveries[0]?.detail).toContain("types: undefined undefined undefined");
    });

    it("enforces the configured timeout on an infinite loop instead of hanging", async () => {
      received = [];
      await client.webhooks.create({
        name: "test snippet timeout",
        eventType: "record.created",
        baseId: null,
        actionKind: "run_snippet",
        config: { code: "while (true) {}", timeoutMs: 200 },
        enabled: true,
      });

      await createAndMergeRecord(blogBaseId, "Timeout test");

      const rules = await client.webhooks.list();
      const timeoutRule = rules.find((r) => r.name === "test snippet timeout");
      const settled = await waitFor(async () => {
        const deliveries = await client.webhooks.deliveries({ ruleId: timeoutRule!.id, limit: 5 });
        return deliveries.length > 0;
      }, 3000);
      expect(settled, "expected a delivery to be recorded within the bounded wait").toBe(true);

      const deliveries = await client.webhooks.deliveries({ ruleId: timeoutRule!.id, limit: 5 });
      expect(deliveries[0]?.status).toBe("failed");
    });
  });

  // ── Test fire ──────────────────────────────────────────────────────────────

  describe("testFire", () => {
    it("fires a rule on demand with a synthetic payload, regardless of enabled state", async () => {
      received = [];
      const rule = await client.webhooks.create({
        name: "test test-fire",
        eventType: "record.created",
        baseId: null,
        actionKind: "webhook",
        config: { targetUrl: hookUrl("test-fire-hook") },
        // Deliberately disabled — testFire must still run.
        enabled: false,
      });

      const delivery = await client.webhooks.testFire({ id: rule.id });
      expect(delivery.ruleId).toBe(rule.id);
      expect(delivery.status).toBe("success");

      // The target must have received a REAL HTTP request, not a mock.
      expect(await waitForHit("test-fire-hook")).toBe(true);
      const hit = received.find((r) => r.path === "/test-fire-hook");
      const parsed = JSON.parse(hit!.body);
      expect(parsed._test).toBe(true);
      expect(parsed.recordId).toBe("test-record");
    });
  });

  // ── Rule limits ────────────────────────────────────────────────────────────
  //
  // Kept LAST in this file (and cleans up after itself) since every test in
  // this suite shares one space — running before other `it`s would starve
  // their rule-creation once the cap is hit.

  describe("rule limits", () => {
    it("rejects creating a rule once a space is at MAX_WEBHOOK_RULES_PER_SPACE", async () => {
      const existing = await client.webhooks.list();
      const toCreate = Math.max(0, MAX_WEBHOOK_RULES_PER_SPACE - existing.length);
      const createdIds: string[] = [];
      try {
        for (let i = 0; i < toCreate; i++) {
          const rule = await client.webhooks.create({
            name: `limit rule ${i}`,
            eventType: "record.created",
            baseId: null,
            actionKind: "webhook",
            config: { targetUrl: hookUrl(`limit-${i}`) },
            enabled: false,
          });
          createdIds.push(rule.id);
        }

        const rulesAtLimit = await client.webhooks.list();
        expect(rulesAtLimit.length).toBe(MAX_WEBHOOK_RULES_PER_SPACE);

        await expect(
          client.webhooks.create({
            name: "one too many",
            eventType: "record.created",
            baseId: null,
            actionKind: "webhook",
            config: { targetUrl: hookUrl("limit-overflow") },
            enabled: false,
          }),
        ).rejects.toThrow();
      } finally {
        // Restore the space to its pre-test rule count.
        await Promise.all(createdIds.map((id) => client.webhooks.delete({ id })));
      }
    });
  });
});
