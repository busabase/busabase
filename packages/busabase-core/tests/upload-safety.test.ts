import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Regression coverage for the AirApp/Skill/Drive upload-safety layer (see
 * `../src/logic/upload-safety.ts`), wired into the two shared file-tree entry
 * points `createFileTreeNode` and `createFileTreeChangeRequest`
 * (`../src/domains/filetree/handlers.ts`) that `airapps`/`skills`/`drives`
 * all funnel through — so this file deliberately spreads its calls across
 * all three domains (and both the create and change-request paths) instead
 * of hammering just one, to prove the wiring is genuinely shared and not
 * accidentally scoped to a single domain.
 *
 * Three independent layers, always applied in this order:
 *   1. `.gitignore` recognition — silent filter (matches `git add .`).
 *   2. Built-in default-deny list — hard reject (`FORBIDDEN_PATH`, 422).
 *   3. Secret content scan — hard reject (`SECRET_DETECTED`, 422), and the
 *      response must never echo the matched secret value — asserted
 *      explicitly below, not just documented.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

// A real-shaped (but non-functional, well-known AWS docs example) access key
// — long enough and correctly prefixed to trip the aws-access-key rule.
const FAKE_AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
const FAKE_STRIPE_KEY = "sk_test_1234567890ABCDEFGH";

describe("Upload safety (.gitignore filter + default-deny list + secret scan) — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-upload-safety-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-upload-safety-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  describe("Layer 1 — .gitignore recognition (silent filter)", () => {
    it("silently excludes a matching .env file from a drive create, and reports which path was skipped", async () => {
      const created = await client.drives.create({
        autoMerge: true,
        slug: "gitignore-drive",
        name: "Gitignore Drive",
        mergeMode: "replace",
        files: [
          { path: ".gitignore", content: ".env\n" },
          { path: ".env", content: "FOO=bar\n" },
          { path: "README.md", content: "# hello\n" },
        ],
      });

      const paths = created.files.map((file) => file.path).sort();
      expect(paths).toEqual([".gitignore", "README.md"]);
      expect(paths).not.toContain(".env");
      expect(created.skippedGitignorePaths).toEqual([".env"]);
    });

    it("rejects with a distinct 'nothing to upload' error when .gitignore filtering leaves nothing", async () => {
      await expect(
        client.drives.create({
          autoMerge: true,
          slug: "all-gitignored-drive",
          name: "All Gitignored Drive",
          mergeMode: "replace",
          files: [
            { path: ".gitignore", content: ".env\n" },
            { path: ".env", content: "FOO=bar\n" },
          ],
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("nothing to upload"),
      });
    });
  });

  describe("Layer 2 — built-in default-deny list (hard reject, unconditional)", () => {
    it("rejects a node_modules-shaped path with FORBIDDEN_PATH when no .gitignore is present", async () => {
      await expect(
        client.skills.create({
          autoMerge: true,
          slug: "denylist-skill",
          name: "Denylist Skill",
          files: [{ path: "node_modules/foo.js", content: "console.log(1);\n" }],
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN_PATH",
        status: 422,
        data: {
          blockedPaths: [{ path: "node_modules/foo.js", pattern: "node_modules/**" }],
        },
      });
    });

    it("rejects a forbidden path proposed through createFileTreeChangeRequest (the update path), not just create", async () => {
      const drive = await client.drives.create({
        autoMerge: true,
        slug: "denylist-update-drive",
        name: "Denylist Update Drive",
      });

      await expect(
        client.drives.createChangeRequest({
          nodeId: drive.node.id,
          message: "Sneak in an ssh key",
          operations: [{ kind: "create", path: ".ssh/id_rsa", content: "not a real key\n" }],
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN_PATH",
        status: 422,
        data: {
          blockedPaths: [{ path: ".ssh/id_rsa", pattern: ".ssh/**" }],
        },
      });
    });
  });

  describe("Layer 3 — secret content scan (hard reject, aggregated, never echoes the match)", () => {
    it("rejects a file whose content matches an AWS-key-shaped string with SECRET_DETECTED, and never echoes the matched value", async () => {
      let caught: unknown;
      try {
        await client.skills.create({
          autoMerge: true,
          slug: "secret-skill",
          name: "Secret Skill",
          files: [{ path: "notes.md", content: `Prod key: ${FAKE_AWS_KEY}\n` }],
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        code: "SECRET_DETECTED",
        status: 422,
        data: {
          findings: [{ path: "notes.md", ruleName: "aws-access-key" }],
        },
      });

      // Critical security property: the matched secret value must never appear
      // anywhere in the serialized error response — only the path + rule name.
      const err = caught as { toJSON?: () => unknown; message?: string; data?: unknown };
      const serialized = JSON.stringify(err.toJSON ? err.toJSON() : err);
      expect(serialized).not.toContain(FAKE_AWS_KEY);
      expect(JSON.stringify(err.message)).not.toContain(FAKE_AWS_KEY);
      expect(JSON.stringify(err.data)).not.toContain(FAKE_AWS_KEY);
    });

    it("aggregates two different secret kinds across two files into one findings array (not fail-fast)", async () => {
      let caught: unknown;
      try {
        await client.drives.create({
          autoMerge: true,
          slug: "multi-secret-drive",
          name: "Multi Secret Drive",
          mergeMode: "replace",
          files: [
            { path: "aws.txt", content: `key=${FAKE_AWS_KEY}\n` },
            { path: "stripe.txt", content: `key=${FAKE_STRIPE_KEY}\n` },
          ],
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeDefined();
      const err = caught as {
        code?: string;
        data?: { findings?: Array<{ path: string; ruleName: string }> };
      };
      expect(err.code).toBe("SECRET_DETECTED");
      const findings = err.data?.findings ?? [];
      expect(findings).toHaveLength(2);
      expect(findings).toEqual(
        expect.arrayContaining([
          { path: "aws.txt", ruleName: "aws-access-key" },
          { path: "stripe.txt", ruleName: "stripe-key" },
        ]),
      );

      const serialized = JSON.stringify(err);
      expect(serialized).not.toContain(FAKE_AWS_KEY);
      expect(serialized).not.toContain(FAKE_STRIPE_KEY);
    });

    it("rejects secret content proposed through createFileTreeChangeRequest (the update path), not just create", async () => {
      const skill = await client.skills.create({
        autoMerge: true,
        slug: "secret-update-skill",
        name: "Secret Update Skill",
      });

      let caught: unknown;
      try {
        await client.skills.createChangeRequest({
          nodeId: skill.node.id,
          message: "Add a config file",
          operations: [{ kind: "create", path: "config.txt", content: `token=${FAKE_AWS_KEY}\n` }],
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        code: "SECRET_DETECTED",
        status: 422,
        data: { findings: [{ path: "config.txt", ruleName: "aws-access-key" }] },
      });
      expect(JSON.stringify(caught)).not.toContain(FAKE_AWS_KEY);
    });
  });

  describe("Robustness — malformed paths never crash the upload-safety layer itself", () => {
    it("a path-traversal-shaped path ('../escape.md') is left to the existing downstream path validation, not an uncaught error from the `ignore` matcher", async () => {
      // The `ignore` package throws a raw RangeError for a `..`-traversal path
      // instead of returning a boolean — upload-safety must swallow that and
      // let `normalizeFilePath` (called later, per-operation) reject it the
      // way it always has, with a clean BAD_REQUEST — not let the matcher's
      // own exception escape uncaught.
      const drive = await client.drives.create({
        autoMerge: true,
        slug: "traversal-drive",
        name: "Traversal Drive",
      });

      await expect(
        client.drives.createChangeRequest({
          nodeId: drive.node.id,
          operations: [{ kind: "create", path: "../escape.md", content: "nope\n" }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("Regression baseline — a clean batch keeps working exactly as before", () => {
    it("a clean batch with no .gitignore, no forbidden paths, and no secrets succeeds unchanged (drives.create)", async () => {
      const created = await client.drives.create({
        autoMerge: true,
        slug: "clean-drive",
        name: "Clean Drive",
        mergeMode: "replace",
        files: [
          { path: "README.md", content: "# Clean\n" },
          { path: "notes/plan.md", content: "Nothing suspicious here.\n" },
        ],
      });
      expect(created.materialized).toBe(true);
      expect(created.files.map((file) => file.path).sort()).toEqual(["README.md", "notes/plan.md"]);
      expect(created.skippedGitignorePaths ?? []).toEqual([]);
    });

    it("a clean batch succeeds through airapps.create specifically — proves the wiring reaches every domain, not just one", async () => {
      const created = await client.airapps.create({
        autoMerge: true,
        slug: "clean-airapp",
        name: "Clean AirApp",
        description: "A perfectly ordinary AirApp.",
      });
      expect(created.materialized).toBe(true);
      expect(created.node.type).toBe("airapp");
      expect(created.skippedGitignorePaths ?? []).toEqual([]);
    });

    it("a clean batch succeeds through skills.create specifically", async () => {
      const created = await client.skills.create({
        autoMerge: true,
        slug: "clean-skill",
        name: "Clean Skill",
      });
      expect(created.materialized).toBe(true);
      expect(created.node.type).toBe("skill");
    });

    it("a metadata_update-only change request is unaffected (no path to check, no content to scan)", async () => {
      const drive = await client.drives.create({
        autoMerge: true,
        slug: "metadata-only-drive",
        name: "Metadata Only Drive",
      });

      const cr = await client.drives.createChangeRequest({
        nodeId: drive.node.id,
        message: "Bump version",
        operations: [{ kind: "metadata_update", metadata: { version: "0.2.0" } }],
      });
      expect(cr.status).toBe("in_review");
      expect(cr.primaryOperation?.operation).toBe("drive_metadata_update");
    });
  });
});
