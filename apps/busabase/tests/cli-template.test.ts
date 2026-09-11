import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The template half of `busabase-cli`, driven through the REAL command line —
 * `runCli(["install", …])`, argument parsing and all — against a real PGLite
 * database over the same in-process `/api/v1` handler the golden-path test uses.
 *
 * What is being proven here is not that the functions work (unit tests cover
 * that) but that the commands a user actually types are wired to them: a flag
 * that never reaches its option, or an option named differently than commander
 * derives it, is invisible to every other layer of testing.
 */

const BASE_URL = "http://localhost:15419";
const ENV_KEYS = ["BUSABASE_API_KEY", "BUSABASE_BASE_URL", "BUSABASE_SPACE_ID", "HOME"] as const;

const zipFiles = async (files: Map<string, string>, archiveRoot: string): Promise<Buffer> => {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [relativePath, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    await writer.add(
      `${archiveRoot}/${relativePath}`,
      // The string directly: Blob already encodes it as UTF-8, and handing it a
      // Uint8Array trips this app's stricter DOM lib types.
      new BlobReader(new Blob([content])),
    );
  }
  return Buffer.from(await (await writer.close()).arrayBuffer());
};

const skillMd = (name: string, resource: string) => `---
name: ${name}
description: The ${name} desk.
metadata:
  busabase:
    template: true
    resources:
      - ${resource}
---

# ${name}
`;

const baseJson = (name: string) =>
  JSON.stringify({
    name,
    description: "",
    position: 0,
    fields: [
      { slug: "kind", name: "Kind", type: "text", required: false, position: 0, options: {} },
    ],
    views: [],
  });

/** One template at the repo root — the ordinary `install <url>` case. */
const singleTemplate = (): Map<string, string> =>
  new Map([
    ["SKILL.md", skillMd("kelly-email", "settings")],
    [
      "busabase.json",
      JSON.stringify({
        format: PACKAGE_FORMAT,
        name: "kelly-email",
        description: "Inbox triage desk",
        template: { category: "email", schemaVersion: 2 },
      }),
    ],
    ["content/settings/base.json", baseJson("Settings")],
    [
      "content/settings/records.ndjson",
      `${JSON.stringify({ key: "s1", fields: { kind: "signature" } })}\n`,
    ],
  ]);

const requiredRelationTemplate = (): Map<string, string> =>
  new Map([
    ["SKILL.md", skillMd("required-crm", "companies")],
    [
      "busabase.json",
      JSON.stringify({
        format: PACKAGE_FORMAT,
        name: "required-crm",
        description: "Required relation fixture",
        template: { category: "crm", schemaVersion: 1 },
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
  ]);

/** A `busabase/skills`-shaped repo: nothing at the root, two templates below. */
const skillsRepo = (): Map<string, string> =>
  new Map([
    ["README.md", "# Skills\n"],
    ["skills/kelly-email/SKILL.md", skillMd("kelly-email", "settings")],
    [
      "skills/kelly-email/busabase.json",
      JSON.stringify({
        format: PACKAGE_FORMAT,
        name: "kelly-email",
        description: "Inbox triage desk",
        template: { category: "email" },
      }),
    ],
    ["skills/kelly-email/content/settings/base.json", baseJson("Settings")],
    ["skills/kelly-crm/SKILL.md", skillMd("kelly-crm", "contacts")],
    [
      "skills/kelly-crm/busabase.json",
      JSON.stringify({
        format: PACKAGE_FORMAT,
        name: "kelly-crm",
        description: "Pipeline desk",
        template: { category: "crm" },
      }),
    ],
    ["skills/kelly-crm/content/contacts/base.json", baseJson("Contacts")],
  ]);

describe("busabase-cli — templates (real command line, in-process server)", () => {
  let dataDir = "";
  let storageDir = "";
  let homeDir = "";
  let outDir = "";
  const originalFetch = global.fetch;
  const savedEnv: Record<string, string | undefined> = {};
  /** Swapped per test so one fake codeload can serve different repositories. */
  let zipball: Buffer;

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-cli-tpl-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-cli-tpl-storage-"));
    homeDir = await mkdtemp(path.join(os.tmpdir(), "busabase-cli-tpl-home-"));
    outDir = await mkdtemp(path.join(os.tmpdir(), "busabase-cli-tpl-out-"));
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    delete process.env.BUSABASE_API_KEY;
    delete process.env.BUSABASE_BASE_URL;
    delete process.env.BUSABASE_SPACE_ID;
    process.env.HOME = homeDir;

    const { busabaseRouter } = await import("busabase-core/router");
    const handler = new OpenAPIHandler(busabaseRouter);
    zipball = await zipFiles(singleTemplate(), "acme-kelly-email-main");

    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.startsWith("https://codeload.github.com/")) {
        return new Response(new Uint8Array(zipball), {
          status: 200,
          headers: { "content-type": "application/zip" },
        });
      }
      const { pathname } = new URL(request.url);
      if (!pathname.startsWith("/api/")) return originalFetch(input as RequestInfo, init);
      const result = await handler.handle(request, { context: {} });
      return result.matched
        ? result.response
        : Response.json({ error: "Not found", path: pathname }, { status: 404 });
    }) as typeof fetch;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    for (const dir of [dataDir, storageDir, homeDir, outDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  const cli = async (...args: string[]): Promise<unknown> => {
    const { runCli } = await import("busabase-cli");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const exitCode = await runCli(["--base-url", BASE_URL, "--output", "json", ...args]);
      if (exitCode !== 0) {
        throw new Error(`busabase-cli ${args.join(" ")} exited ${exitCode}: ${err.mock.calls}`);
      }
      const last = log.mock.calls.at(-1)?.[0];
      return typeof last === "string" ? JSON.parse(last) : last;
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  };

  it("installs a template and merges its sample rows, without --auto-merge", async () => {
    zipball = await zipFiles(singleTemplate(), "acme-kelly-email-main");
    const result = (await cli("install", "https://github.com/acme/kelly-email")) as {
      installed: boolean;
      created: { records: number; bases: number };
      pendingChangeRequests: number;
    };
    expect(result.installed).toBe(true);
    expect(result.created.bases).toBe(1);
    // The sample row is live: a template's promise is an app that works when
    // opened, and this is the flag-free default.
    expect(result.created.records).toBe(1);
  });

  it("installs required sample relations through the real CLI command", async () => {
    zipball = await zipFiles(requiredRelationTemplate(), "acme-required-crm-main");
    const result = (await cli(
      "install",
      "https://github.com/acme/required-crm",
      "--into-folder",
      "required-crm-cli",
    )) as {
      installed: boolean;
      created: { records: number; bases: number };
      pendingChangeRequests: number;
    };
    expect(result.installed).toBe(true);
    expect(result.created).toMatchObject({ bases: 2, records: 2 });

    const bases = (await cli("bases", "list")) as Array<{ id: string; slug: string }>;
    const companies = bases.find((base) => base.slug === "required-crm-cli-companies");
    const contacts = bases.find((base) => base.slug === "required-crm-cli-contacts");
    const companyRows = (await cli("records", "list", "--base-id", companies?.id ?? "")) as {
      records: Array<{ id: string }>;
    };
    const contactRows = (await cli("records", "list", "--base-id", contacts?.id ?? "")) as {
      records: Array<{ id: string }>;
    };
    const links = (await cli(
      "records",
      "list-links",
      "--record-id",
      contactRows.records[0]?.id ?? "",
    )) as Array<{ targetRecordId: string }>;
    expect(links.map((link) => link.targetRecordId)).toEqual([companyRows.records[0]?.id]);
  });

  it("honours --no-sample-records, proposing the rows instead", async () => {
    zipball = await zipFiles(singleTemplate(), "acme-kelly-email-main");
    // commander derives `sampleRecords: false` from `--no-sample-records`; a
    // mis-wired option here would silently keep merging.
    const result = (await cli(
      "install",
      "https://github.com/acme/kelly-email",
      "--into-folder",
      "email-no-samples",
      "--no-sample-records",
      // This file installs the SAME template a second time. Base slugs are
      // folder-prefixed but a Skill slug is not, so the second copy collides —
      // which only became visible once content merged by default (it used to sit
      // as an unmerged proposal, leaving the slug free until someone approved it
      // and hit the same conflict then). `--rename` is the CLI's answer to a
      // collision; nothing here is about sample records.
      "--rename",
    )) as { created: { records: number }; pendingChangeRequests: number };
    expect(result.created.records).toBe(0);
    expect(result.pendingChangeRequests).toBeGreaterThan(0);
  });

  it("prefixes Base slugs with the target folder", async () => {
    const bases = (await cli("bases", "list")) as Array<{ slug: string }>;
    expect(bases.map((base) => base.slug)).toEqual(
      expect.arrayContaining(["kelly-email-settings", "email-no-samples-settings"]),
    );
  });

  it("lists the choices when the URL is a repository of packages", async () => {
    zipball = await zipFiles(skillsRepo(), "busabase-skills-main");
    const result = (await cli("install", "https://github.com/busabase/skills")) as {
      chooseOne: boolean;
      candidates: Array<{ name: string; subdir: string; isTemplate: boolean }>;
    };
    expect(result.chooseOne).toBe(true);
    expect(result.candidates.map((entry) => entry.name).sort()).toEqual([
      "kelly-crm",
      "kelly-email",
    ]);
    expect(result.candidates.every((entry) => entry.isTemplate)).toBe(true);
  });

  it("installs the one picked with --skill", async () => {
    zipball = await zipFiles(skillsRepo(), "busabase-skills-main");
    const result = (await cli(
      "install",
      "https://github.com/busabase/skills",
      "--skill",
      "kelly-crm",
    )) as { installed: boolean; created: { bases: number } };
    expect(result.installed).toBe(true);
    const bases = (await cli("bases", "list")) as Array<{ slug: string }>;
    expect(bases.map((base) => base.slug)).toContain("kelly-crm-contacts");
  });

  it("exports an installed template, carrying its real manual rather than a draft", async () => {
    const target = path.join(outDir, "kelly-crm-export");
    const result = (await cli("export", "kelly-crm", "-o", target, "--template")) as {
      files: string[];
      warnings: string[];
    };
    expect(result.files).toContain("SKILL.md");
    // Not a draft: the installed template's own manual is a real Skill node in
    // the folder now, so export round-trips what the author wrote. It only
    // became one once content merged by default — it used to sit as an unmerged
    // proposal, so the folder looked manual-less and export invented a draft.
    expect(result.warnings.join()).not.toContain("draft");

    const manual = await readFile(path.join(target, "SKILL.md"), "utf8");
    expect(manual).toContain("template: true");
    // Verbatim what the package author shipped — including their own resource
    // slug, not the folder-prefixed one install created. Exporting the prefixed
    // slug would make the package say something its author never wrote, and
    // re-installing it would prefix the prefix.
    expect(manual).toContain("- contacts");
    expect(manual).not.toContain("kelly-crm-contacts");

    const manifest = JSON.parse(await readFile(path.join(target, "busabase.json"), "utf8"));
    expect(manifest.template).toBeDefined();
  });

  it("writes a SKILL.md draft when the folder genuinely has no manual", async () => {
    // A folder built by hand, not installed from a template — the case the draft
    // generator exists for. Every installed folder in this file now carries the
    // template's real manual, so the draft path needs its own fixture.
    const { createRouterClient } = await import("@orpc/server");
    const { busabaseRouter } = await import("busabase-core/router");
    const client = createRouterClient(busabaseRouter);
    const folder = await client.nodes.createChangeRequest({
      message: "A hand-built folder",
      autoMerge: true,
      operations: [
        { kind: "create", nodeType: "folder", slug: "plain-notes", name: "Notes", description: "" },
      ],
    });
    await client.bases.create({
      parentNodeId: folder.operations[0]?.nodeId as string,
      slug: "jottings",
      name: "Jottings",
      fields: [{ slug: "kind", name: "Kind", type: "text", required: false }],
      autoMerge: true,
    });

    const target = path.join(outDir, "plain-notes-export");
    const result = (await cli("export", "plain-notes", "-o", target, "--template")) as {
      files: string[];
      warnings: string[];
    };
    expect(result.files).toContain("SKILL.md");
    expect(result.warnings.join()).toContain("draft");

    const draft = await readFile(path.join(target, "SKILL.md"), "utf8");
    // Deterministic, never invented: the draft names the tables that exist and
    // leaves every judgement as an explicit TODO rather than guessing at it.
    expect(draft).toContain("template: true");
    expect(draft).toContain('- "jottings"');
    expect(draft).toContain("TODO");
  });

  it("round-trips: the exported template installs again, into its own namespace", async () => {
    const target = path.join(outDir, "kelly-crm-export");
    const files = new Map<string, string>();
    for (const name of ["SKILL.md", "busabase.json"]) {
      files.set(name, await readFile(path.join(target, name), "utf8"));
    }
    files.set(
      "content/contacts/base.json",
      await readFile(path.join(target, "content/contacts/base.json"), "utf8"),
    );
    zipball = await zipFiles(files, "me-kelly-crm-main");

    // Without `--rename` this now stops UP FRONT with a named collision instead
    // of installing: Base slugs are folder-prefixed, but a template's manual is a
    // Skill and skill slugs are unique per SPACE, so the second copy wants a slug
    // the first one holds. It always did — that conflict simply used to be
    // deferred until someone approved the first copy's manual. What changed is
    // that the planner now SEES the manual, so this is a clean pre-flight refusal
    // that names `--rename`, not a mid-install failure and rollback.
    await expect(
      cli("install", "https://github.com/me/kelly-crm", "--into-folder", "crm-again"),
    ).rejects.toThrow(/collide|--rename/);

    const ok = (await cli(
      "install",
      "https://github.com/me/kelly-crm",
      "--into-folder",
      "crm-again",
      "--rename",
    )) as { installed: boolean };
    expect(ok.installed).toBe(true);

    // Prefixed against the NEW folder, so the two installs coexist rather than
    // colliding — which is the whole reason slugs are prefixed at install time
    // and restored at export time rather than baked into the package.
    const bases = (await cli("bases", "list")) as Array<{ slug: string }>;
    expect(bases.map((base) => base.slug)).toEqual(
      expect.arrayContaining(["kelly-crm-contacts", "crm-again-contacts"]),
    );

    // And the second copy's manual is suffixed rather than lost, so both apps
    // keep a manual their agents can find.
    type TreeNode = { type: string; slug: string; children?: TreeNode[] };
    const flatten = (nodes: TreeNode[]): TreeNode[] =>
      nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
    const skillSlugs = flatten((await cli("nodes", "list")) as TreeNode[])
      .filter((node) => node.type === "skill")
      .map((node) => node.slug);
    expect(skillSlugs).toEqual(expect.arrayContaining(["kelly-crm", "kelly-crm-2"]));
  });
});
