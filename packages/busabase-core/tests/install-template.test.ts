import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import {
  APP_ROOT_RESOURCE_KEY,
  TEMPLATE_SKILL_METADATA_KEY,
} from "busabase-contract/domains/package/template";
import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { BUSABASE_MCP_APPS_TOPIC, busabaseMcpGuideTool } from "../src/mcp-skill";
import { busabaseRouter } from "../src/router";

/**
 * Installing a TEMPLATE, against a real PGLite database and the real
 * `install.fromGithub` procedure — the whole path a user's click takes
 * (codeload URL → SSRF guard → zip → read → plan → five-pass apply → DB).
 *
 * Everything here is asserted by reading the database BACK, not by trusting the
 * install's own return value. The bug this file exists to catch is precisely the
 * one a return value cannot show: a template that quietly installs as a plain
 * package, reporting success while stamping nothing and landing no Skill node.
 *
 * Sibling of `install-from-github.test.ts`, which covers the plain-package path.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const zipFiles = async (files: Map<string, string>, archiveRoot: string): Promise<Buffer> => {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [relativePath, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    await writer.add(
      `${archiveRoot}/${relativePath}`,
      new BlobReader(new Blob([new TextEncoder().encode(content)])),
    );
  }
  const blob = await writer.close();
  return Buffer.from(await blob.arrayBuffer());
};

/**
 * A realistic template: a manual at the root, a Base whose slug (`settings`) is
 * exactly the kind every app wants, sample rows, and an AirApp.
 */
const templateFiles = (): Map<string, string> =>
  new Map<string, string>([
    [
      "SKILL.md",
      `---
name: kelly-email
description: Inbox triage and reply-approval desk.
metadata:
  busabase:
    template: true
    resources:
      - settings
---

# Kelly Email

Triage the inbox, draft replies, and wait for approval before sending.
`,
    ],
    ["references/schema.md", "# Field reference\n"],
    [
      "busabase.json",
      JSON.stringify({
        format: PACKAGE_FORMAT,
        name: "kelly-email",
        description: "Inbox triage desk",
        version: "1.2.0",
        template: {
          category: "email",
          schemaVersion: 3,
          airapp: "kelly-email-app",
          agentPrompts: ["Triage today's mail"],
        },
      }),
    ],
    [
      "content/settings/base.json",
      JSON.stringify({
        name: "Settings",
        description: "One row per setting",
        position: 0,
        fields: [
          { slug: "kind", name: "Kind", type: "text", required: true, position: 0, options: {} },
          { slug: "value", name: "Value", type: "text", required: false, position: 1, options: {} },
        ],
        views: [],
      }),
    ],
    [
      "content/settings/records.ndjson",
      [
        JSON.stringify({ key: "s_signature", fields: { kind: "signature", value: "— Kelly" } }),
        JSON.stringify({ key: "s_tone", fields: { kind: "tone", value: "warm" } }),
      ].join("\n"),
    ],
    [
      "content/kelly-email-app/_node.json",
      JSON.stringify({ type: "airapp", name: "Kelly Email", description: "The desk" }),
    ],
    [
      "content/kelly-email-app/package.json",
      JSON.stringify({ name: "kelly-email-app", scripts: { dev: "node server.js" } }),
    ],
    ["content/kelly-email-app/server.js", "// hono server\n"],
    ["content/kelly-email-app/.busabaseignore", "test/\n"],
    ["content/kelly-email-app/test/desk.test.mjs", "// never deployed\n"],
  ]);

describe("install.fromGithub — a template", () => {
  let client: Client;
  let dataDir: string | undefined;
  let storageDir: string | undefined;
  let originalCwd: string | undefined;
  const originalFetch = global.fetch;

  const inSpace = <T>(spaceId: string, fn: () => Promise<T>): Promise<T> =>
    runWithBusabaseContext({ spaceId }, fn);

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-tpl-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-tpl-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    // Boot PGLite (and migrate) BEFORE swapping `global.fetch` — PGLite loads
    // its wasm through fetch, so a test-owned fetch installed first would sit in
    // the middle of database startup.
    await runWithBusabaseContext({ spaceId: "space_tpl_warmup" }, () => client.nodes.list());

    const zipball = await zipFiles(templateFiles(), "busabase-skills-main");
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (rawUrl.startsWith("https://codeload.github.com/")) {
        return new Response(new Uint8Array(zipball), {
          status: 200,
          headers: { "content-type": "application/zip" },
        });
      }
      return originalFetch(input as RequestInfo, init);
    }) as typeof fetch;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  /** Install into a fresh space and read the resulting tree back out of the DB. */
  const install = async (spaceId: string, autoMerge: boolean) => {
    const result = await inSpace(spaceId, () =>
      client.install.fromGithub({
        repoUrl: "https://github.com/busabase/skills/tree/v1.2.0",
        autoMerge,
      }),
    );
    const nodes = await inSpace(spaceId, () => client.nodes.list());
    const roots = nodes.length === 1 && nodes[0].children ? nodes[0].children : nodes;
    const folder = roots.find((node) => node.slug === "kelly-email");
    return { result, folder, children: folder?.children ?? [] };
  };

  // ── The review-first install: the DEFAULT path a user takes ────────────────
  describe("review-first (the default)", () => {
    const SPACE = "space_tpl_review_first";
    let installed: Awaited<ReturnType<typeof install>>;

    beforeAll(async () => {
      installed = await install(SPACE, false);
    });

    it("stamps the app's root Folder with the triple busabase-sdk recognises", () => {
      // Read back from the DB, not from the install's return value: this stamp is
      // what stops a skill's own `setup.mjs` from treating the user's freshly
      // installed workspace as a stranger's and refusing to touch it.
      expect(installed.folder?.metadata).toMatchObject({
        appId: "kelly-email",
        resourceKey: APP_ROOT_RESOURCE_KEY,
        schemaVersion: 3,
        version: "1.2.0",
      });
    });

    it("remembers where the package came from, so an upgrade can be offered later", () => {
      expect((installed.folder?.metadata as { source?: unknown }).source).toMatchObject({
        repo: "busabase/skills",
        ref: "v1.2.0",
      });
    });

    it("installs the Base folder-prefixed, so a second template's `settings` cannot collide", () => {
      const base = installed.children.find((node) => node.type === "base");
      expect(base?.slug).toBe("kelly-email-settings");
    });

    it("stamps that Base with the slug the PACKAGE declared, not the installed one", () => {
      const base = installed.children.find((node) => node.type === "base");
      expect(base?.metadata).toMatchObject({
        appId: "kelly-email",
        resourceKey: "settings",
        schemaVersion: 3,
      });
    });

    it("has the sample rows LIVE in the Base, without the user approving anything", async () => {
      // The promise a template makes: open it and it works. Reading the rows back
      // is the only way to know they were merged rather than proposed — the
      // install's own record count would look the same either way.
      const base = installed.children.find((node) => node.type === "base");
      const records = await inSpace(SPACE, () =>
        client.records.list({ baseId: base?.baseId ?? "" }),
      );
      // A record's live values are its head commit's payload — reading them is
      // what distinguishes "merged" from "proposed"; a pending record would have
      // no head commit here at all.
      expect(
        records.records
          .map((row) => (row.headCommit?.payload as { kind?: string } | undefined)?.kind)
          .sort(),
      ).toEqual(["signature", "tone"]);
      expect(installed.result.created.records).toBe(2);
    });

    it("holds the executable parts — the AirApp and the Skill — for review", () => {
      // The sample-record exception must not leak into anything that runs. Both
      // the app's code and its agent instructions stay proposals until a human
      // reads them, which is the entire trust story for installing a stranger's
      // template.
      expect(installed.children.some((node) => node.type === "airapp")).toBe(false);
      expect(installed.children.some((node) => node.type === "skill")).toBe(false);
      expect(installed.result.pendingChangeRequests).toBe(2);
    });
  });

  // ── The reviewed (or trusted) install: what the user gets after merging ────
  describe("after review (install without review)", () => {
    const SPACE = "space_tpl_auto_merge";
    let installed: Awaited<ReturnType<typeof install>>;

    beforeAll(async () => {
      installed = await install(SPACE, true);
    });

    it("lands the root SKILL.md as a Skill node inside the app's folder", async () => {
      const skill = installed.children.find((node) => node.type === "skill");
      expect(skill?.slug).toBe("kelly-email");
      const files = await inSpace(SPACE, () =>
        client.fileTrees.listFiles({ nodeId: skill?.id ?? "", type: "skill" }),
      );
      // This is the "soul" of a template: the manual travels with the resources,
      // so the agent a user talks to next already knows what this app is for.
      expect(files.map((file) => file.path).sort()).toEqual(["SKILL.md", "references/schema.md"]);
    });

    it("marks that Skill node so a later export lifts it back to the package root", () => {
      const skill = installed.children.find((node) => node.type === "skill");
      expect((skill?.metadata as Record<string, unknown>)[TEMPLATE_SKILL_METADATA_KEY]).toBe(true);
      expect(skill?.metadata).toMatchObject({ appId: "kelly-email" });
    });

    it("installs the AirApp, minus everything .busabaseignore excluded", async () => {
      const airapp = installed.children.find((node) => node.type === "airapp");
      expect(airapp?.slug).toBe("kelly-email-app");
      const files = await inSpace(SPACE, () =>
        client.fileTrees.listFiles({ nodeId: airapp?.id ?? "", type: "airapp" }),
      );
      // `test/` was ignored; `package.json` — which nodepod boots from — was not.
      expect(files.map((file) => file.path).sort()).toEqual(["package.json", "server.js"]);
    });

    it("hands the app's manual to an agent through the MCP guide tool", async () => {
      // The end of the chain this whole feature exists for: a template was
      // installed, and an agent connected to THIS workspace can now read the
      // manual its author wrote. Driven through the real guide tool with the
      // real router client, so nothing between the database and the agent is
      // stubbed.
      const tool = busabaseMcpGuideTool(["workspace", "airapp", BUSABASE_MCP_APPS_TOPIC], {
        spaceTargeting: false,
      });
      const listed = (await inSpace(SPACE, () =>
        tool.execute(client as never, { topic: BUSABASE_MCP_APPS_TOPIC }),
      )) as { apps: { slug: string; readWith: string }[] };
      expect(listed.apps.map((app) => app.slug)).toEqual(["kelly-email"]);

      const manual = (await inSpace(SPACE, () =>
        tool.execute(client as never, { topic: listed.apps[0].readWith }),
      )) as { content: string };
      // The author's own words, all the way from the package root's SKILL.md.
      expect(manual.content).toContain("Triage the inbox, draft replies");
      expect(manual.content).toContain("# Field reference");
    });

    it("stamps the AirApp as the app's own", () => {
      const airapp = installed.children.find((node) => node.type === "airapp");
      expect(airapp?.metadata).toMatchObject({
        appId: "kelly-email",
        resourceKey: "kelly-email-app",
        schemaVersion: 3,
      });
    });
  });
});
