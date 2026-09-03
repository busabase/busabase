import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient, ORPCError } from "@orpc/server";
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import {
  InstallFailureVOSchema,
  installFailureTouchedWorkspace,
} from "busabase-contract/domains/install/types";
import {
  APP_ROOT_RESOURCE_KEY,
  TEMPLATE_SKILL_METADATA_KEY,
} from "busabase-contract/domains/package/template";
import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { toInstallOrpcError } from "../src/domains/install/logic/install-logic";
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

const requiredRelationTemplateFiles = (): Map<string, string> =>
  new Map<string, string>([
    [
      "SKILL.md",
      `---
name: required-crm
description: Required relation install fixture.
metadata:
  busabase:
    template: true
    resources:
      - companies
      - contacts
      - activities
---

# Required CRM
`,
    ],
    [
      "busabase.json",
      JSON.stringify({
        format: PACKAGE_FORMAT,
        name: "required-crm",
        description: "Required relation install fixture",
        version: "1.0.0",
        template: { category: "crm", schemaVersion: 1, airapp: "required-crm-app" },
      }),
    ],
    [
      "content/companies/base.json",
      JSON.stringify({
        name: "Companies",
        fields: [
          { slug: "name", name: "Name", type: "text", required: true, position: 0, options: {} },
        ],
        views: [],
      }),
    ],
    [
      "content/companies/records.ndjson",
      `${JSON.stringify({ key: "company-1", fields: { name: "Northstar" } })}\n`,
    ],
    [
      "content/contacts/base.json",
      JSON.stringify({
        name: "Contacts",
        fields: [
          { slug: "name", name: "Name", type: "text", required: true, position: 0, options: {} },
          {
            slug: "company",
            name: "Company",
            type: "relation",
            required: true,
            position: 1,
            options: { multiple: false, targetBaseSlug: "companies" },
          },
        ],
        views: [],
      }),
    ],
    [
      "content/contacts/records.ndjson",
      `${JSON.stringify({ key: "contact-1", fields: { name: "Maya", company: "company-1" } })}\n`,
    ],
    [
      "content/activities/base.json",
      JSON.stringify({
        name: "Activities",
        fields: [
          {
            slug: "subject",
            name: "Subject",
            type: "text",
            required: true,
            position: 0,
            options: {},
          },
          {
            slug: "company",
            name: "Company",
            type: "relation",
            required: true,
            position: 1,
            options: { multiple: false, targetBaseSlug: "companies" },
          },
          {
            slug: "contact",
            name: "Contact",
            type: "relation",
            required: true,
            position: 2,
            options: { multiple: false, targetBaseSlug: "contacts" },
          },
        ],
        views: [],
      }),
    ],
    [
      "content/activities/records.ndjson",
      `${JSON.stringify({
        key: "activity-1",
        fields: { subject: "Discovery call", company: "company-1", contact: "contact-1" },
      })}\n`,
    ],
    [
      "content/required-crm-app/_node.json",
      JSON.stringify({ type: "airapp", name: "Required CRM", description: "Fixture app" }),
    ],
    [
      "content/required-crm-app/package.json",
      JSON.stringify({ name: "required-crm-app", scripts: { dev: "node server.js" } }),
    ],
    ["content/required-crm-app/server.js", "// fixture\n"],
  ]);

const requiredRelationCycleFiles = (): Map<string, string> => {
  const files = requiredRelationTemplateFiles();
  files.set(
    "content/companies/base.json",
    JSON.stringify({
      name: "Companies",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, position: 0, options: {} },
        {
          slug: "contact",
          name: "Contact",
          type: "relation",
          required: true,
          position: 1,
          options: { multiple: false, targetBaseSlug: "contacts" },
        },
      ],
      views: [],
    }),
  );
  files.set(
    "content/companies/records.ndjson",
    `${JSON.stringify({ key: "company-1", fields: { name: "Northstar", contact: "contact-1" } })}\n`,
  );
  return files;
};

/**
 * A failure the planner CANNOT preflight: an OPTIONAL number field carrying a
 * value that is not a number, which only the Base rejects, and only in pass 4 —
 * after the folder, the three Bases and the AirApp/Skill change requests already
 * exist.
 *
 * It has to be a kind of breakage the preflight is blind to, and "required field
 * with no value" no longer qualifies: `findUnsatisfiableRequiredFields` catches
 * exactly that, before anything is created. Preflight only reasons about
 * required-ness, never about whether a value fits its field's type — so this
 * still reaches pass 4, and that is the path being tested. Not every runtime
 * failure is predictable (permissions, a dropped connection, a constraint the
 * planner does not model), so the partial-install path stays reachable and needs
 * to keep behaving.
 */
const runtimeFailureFiles = (): Map<string, string> => {
  const files = requiredRelationTemplateFiles();
  const activities = JSON.parse(files.get("content/activities/base.json") ?? "{}");
  activities.fields.push({
    slug: "hours",
    name: "Hours",
    type: "number",
    required: false,
    position: 3,
    options: {},
  });
  files.set("content/activities/base.json", JSON.stringify(activities));
  files.set(
    "content/activities/records.ndjson",
    `${JSON.stringify({
      key: "activity-1",
      fields: {
        subject: "Discovery call",
        company: "company-1",
        contact: "contact-1",
        hours: "soon",
      },
    })}\n`,
  );
  return files;
};

describe("install.fromGithub — a template", () => {
  let client: Client;
  let dataDir: string | undefined;
  let storageDir: string | undefined;
  let originalCwd: string | undefined;
  const originalFetch = global.fetch;
  let zipball: Buffer;

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

    zipball = await zipFiles(templateFiles(), "busabase-skills-main");
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

  // ── The preview a user reads BEFORE any of the above ──────────────────────
  describe("planFromGithub — the preview", () => {
    it("shows the manual as a node it will create, and counts it", async () => {
      // The root SKILL.md lands as a Skill node on install, but the package tree
      // carries it beside `nodes` rather than in it — so the preview used to
      // report `skills: 0` and list no manual for a package that plainly has
      // one. The install dialog reads exactly this to decide whether an agent
      // has anything to install, so a silent zero is not cosmetic.
      const plan = await inSpace("space_tpl_plan", () =>
        client.install.planFromGithub({
          repoUrl: "https://github.com/busabase/skills/tree/v1.2.0",
        }),
      );

      expect(plan.counts.skills).toBe(1);
      const skillRows = plan.nodes.filter((node) => node.type === "skill");
      expect(skillRows).toHaveLength(1);
      expect(skillRows[0]?.slug).toBe("kelly-email");
      expect(skillRows[0]?.fileCount ?? 0).toBeGreaterThan(0);
    });
  });

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

  describe("required sample relations", () => {
    it("installs dependent sample rows in canonical relation order", async () => {
      zipball = await zipFiles(requiredRelationTemplateFiles(), "required-crm-main");
      const spaceId = "space_tpl_required_relations";

      const result = await inSpace(spaceId, () =>
        client.install.fromGithub({
          repoUrl: "https://github.com/acme/required-crm",
          autoMerge: false,
        }),
      );
      const nodes = await inSpace(spaceId, () => client.nodes.list());
      const roots = nodes.length === 1 && nodes[0].children ? nodes[0].children : nodes;
      const folder = roots.find((node) => node.slug === "required-crm");
      const companies = folder?.children.find((node) => node.metadata?.resourceKey === "companies");
      const contacts = folder?.children.find((node) => node.metadata?.resourceKey === "contacts");
      const activities = folder?.children.find(
        (node) => node.metadata?.resourceKey === "activities",
      );

      const companyRows = await inSpace(spaceId, () =>
        client.records.list({ baseId: companies?.baseId ?? "" }),
      );
      const contactRows = await inSpace(spaceId, () =>
        client.records.list({ baseId: contacts?.baseId ?? "" }),
      );
      const activityRows = await inSpace(spaceId, () =>
        client.records.list({ baseId: activities?.baseId ?? "" }),
      );
      expect([
        companyRows.records.length,
        contactRows.records.length,
        activityRows.records.length,
      ]).toEqual([1, 1, 1]);

      const companyId = companyRows.records[0]?.id ?? "";
      const contactId = contactRows.records[0]?.id ?? "";
      const contactLinks = await inSpace(spaceId, () =>
        client.records.listLinks({ recordId: contactId }),
      );
      const activityLinks = await inSpace(spaceId, () =>
        client.records.listLinks({ recordId: activityRows.records[0]?.id ?? "" }),
      );
      expect(contactLinks.map((link) => link.targetRecordId)).toEqual([companyId]);
      expect(activityLinks.map((link) => [link.fieldSlug, link.targetRecordId]).sort()).toEqual([
        ["company", companyId],
        ["contact", contactId],
      ]);
      expect(result.created.records).toBe(3);
      expect(result.pendingChangeRequests).toBe(2);
    });

    it("rejects a required relation cycle during preview without creating nodes", async () => {
      zipball = await zipFiles(requiredRelationCycleFiles(), "required-crm-cycle-main");
      const spaceId = "space_tpl_required_cycle";

      await expect(
        inSpace(spaceId, () =>
          client.install.planFromGithub({ repoUrl: "https://github.com/acme/required-crm" }),
        ),
      ).rejects.toThrow("Required sample relations contain a cycle");

      const nodes = await inSpace(spaceId, () => client.nodes.list());
      const roots = nodes.length === 1 && nodes[0].children ? nodes[0].children : nodes;
      expect(roots).toHaveLength(0);
    });

    /**
     * The failure the test below used to provoke, now caught before anything is
     * created — which is the whole point of preflighting it. A dry run that
     * printed a clean plan for a package guaranteed to die in pass 4 was worse
     * than useless: it told the user to go ahead.
     */
    it("rejects a package that cannot satisfy its own required fields, creating nothing", async () => {
      const files = requiredRelationTemplateFiles();
      files.set(
        "content/activities/records.ndjson",
        `${JSON.stringify({
          key: "activity-1",
          fields: { company: "company-1", contact: "contact-1" },
        })}\n`,
      );
      zipball = await zipFiles(files, "required-crm-unsatisfiable-main");
      const spaceId = "space_tpl_unsatisfiable_required";

      await expect(
        inSpace(spaceId, () =>
          client.install.fromGithub({
            repoUrl: "https://github.com/acme/required-crm",
            autoMerge: true,
          }),
        ),
      ).rejects.toThrow("cannot satisfy its own required fields");

      const nodes = await inSpace(spaceId, () => client.nodes.list());
      const roots = nodes.length === 1 && nodes[0].children ? nodes[0].children : nodes;
      expect(roots).toHaveLength(0);
    });

    it("reports a partial install as an ORPCError carrying the diagnostics", async () => {
      zipball = await zipFiles(runtimeFailureFiles(), "required-crm-runtime-main");
      const spaceId = "space_tpl_partial_install";

      const caught = await inSpace(spaceId, () =>
        client.install
          .fromGithub({ repoUrl: "https://github.com/acme/required-crm", autoMerge: false })
          .then(
            () => undefined,
            (error: unknown) => error,
          ),
      );

      // Must be an ORPCError. oRPC replaces anything else with a bare
      // "Internal server error" on the way to the browser, and the message below
      // is the only thing telling the user their space now holds half an install
      // — `createRouterClient` here does not serialize, so nothing but this
      // assertion catches a regression to a plain `Error`.
      expect(caught).toBeInstanceOf(ORPCError);
      const error = caught as ORPCError<string, unknown>;
      expect(error.message).toContain("Install stopped during Pass 4/5 (sample records)");
      expect(error.message).toContain("Hours must be a number");

      const failure = InstallFailureVOSchema.safeParse(error.data);
      expect(failure.success).toBe(true);
      if (!failure.success) return;
      expect(failure.data.targetFolderSlug).toBe("required-crm");
      expect(failure.data.created.bases).toBe(3);
      expect(installFailureTouchedWorkspace(failure.data)).toBe(true);

      // The failure rolls itself back, so the tree the user is left with no
      // longer holds the half-install — but it DID change on the way there, so
      // the client still has to refresh rather than treat this as a no-op.
      expect(error.message).toContain("Rolled back");
      const nodes = await inSpace(spaceId, () => client.nodes.list());
      const roots = nodes.length === 1 && nodes[0].children ? nodes[0].children : nodes;
      expect(roots.find((node) => node.slug === "required-crm")).toBeUndefined();

      // Trashed, not destroyed. This is an automatic action taken while
      // something has already gone wrong, so it has to stay reversible: the
      // folder and everything under it is still restorable from Trash.
      const trashed = await inSpace(spaceId, () => client.nodes.list({ status: "archived" }));
      expect(trashed.some((node) => node.slug === "required-crm")).toBe(true);
    });
  });
});

/**
 * The failure mapping on its own. The end-to-end test above covers the branch a
 * real install actually took; these cover the two it did not, and both are worse
 * if they regress — a plain `Error` loses its MESSAGE at the boundary, and an
 * error carrying a `code` loses the difference between "not allowed" and "broken".
 */
describe("toInstallOrpcError", () => {
  const details = {
    phase: "Pass 4/5 (sample records)",
    targetFolderSlug: "b2b-crm",
    created: { folders: 1, docs: 0, bases: 3, views: 3, records: 1, fileTreeNodes: 0, files: 0 },
    pendingChangeRequests: 2,
  };
  const withDetails = <T extends Error>(error: T): T => {
    Object.defineProperty(error, "busabaseInstallFailure", {
      value: details,
      enumerable: false,
    });
    return error;
  };

  it("keeps a plain Error's message, which oRPC would otherwise replace", () => {
    const mapped = toInstallOrpcError(withDetails(new Error("Install stopped during Pass 4/5.")));
    expect(mapped).toBeInstanceOf(ORPCError);
    expect(mapped.code).toBe("INTERNAL_SERVER_ERROR");
    expect(mapped.message).toBe("Install stopped during Pass 4/5.");
    expect(InstallFailureVOSchema.parse(mapped.data)).toEqual(details);
  });

  it("keeps a code carried as a property, rather than flattening it to a 500", () => {
    const refused = Object.assign(new Error("You may not merge this change request."), {
      code: "FORBIDDEN",
    });
    const mapped = toInstallOrpcError(withDetails(refused));
    expect(mapped.code).toBe("FORBIDDEN");
    expect(mapped.status).toBe(403);
    expect(InstallFailureVOSchema.parse(mapped.data)).toEqual(details);
  });

  it("keeps an ORPCError's code, status and existing data", () => {
    const original = new ORPCError("CONFLICT", {
      message: "Slug already taken.",
      data: { slug: "contacts" },
    });
    const mapped = toInstallOrpcError(withDetails(original));
    expect([mapped.code, mapped.status, mapped.message]).toEqual([
      "CONFLICT",
      409,
      "Slug already taken.",
    ]);
    expect(mapped.data).toMatchObject({ slug: "contacts", targetFolderSlug: "b2b-crm" });
  });

  it("passes an unrelated failure through without inventing diagnostics", () => {
    const mapped = toInstallOrpcError(new Error("boom"));
    expect([mapped.code, mapped.message, mapped.data]).toEqual([
      "INTERNAL_SERVER_ERROR",
      "boom",
      undefined,
    ]);
  });
});
