import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import { type PackageFiles, readPackageTree } from "./layout-read";
import { renderPackageTree } from "./layout-write";
import { deriveSkillDraft, validateTemplate } from "./template";

const utf8 = (text: string): Buffer => Buffer.from(text, "utf8");

const SKILL_MD = `---
name: kelly-email
description: Inbox triage and reply-approval desk.
metadata:
  busabase:
    template: true
    resources:
      - reviews
    agentPrompts:
      - triage today's mail
---

# Kelly Email

Use this when the user mentions inbox, triage, or reply drafts.
`;

const BASE_JSON = JSON.stringify(
  {
    name: "Email Reviews",
    fields: [{ slug: "subject", name: "Subject", type: "text", position: 0 }],
  },
  null,
  2,
);

const APP_PACKAGE_JSON = JSON.stringify(
  { name: "kelly-email-app", scripts: { dev: "node server.js" } },
  null,
  2,
);

/**
 * A complete, valid template on disk. Each test mutates one thing away from
 * this baseline, so a failure names exactly the rule that fired.
 */
const templateFiles = (overrides: Record<string, string | null> = {}): PackageFiles => {
  const base: Record<string, string> = {
    "SKILL.md": SKILL_MD,
    "references/schema.md": "# Field reference\n",
    "scripts/setup.mjs": "// provisioning entrypoint\n",
    "busabase.json": JSON.stringify(
      {
        format: PACKAGE_FORMAT,
        name: "kelly-email",
        description: "Inbox triage desk",
        template: {
          category: "email",
          airapp: "kelly-email-app",
          agentPrompts: ["triage today's mail"],
          screenshots: ["assets/screenshots/overview.webp"],
        },
      },
      null,
      2,
    ),
    "content/reviews/base.json": BASE_JSON,
    "content/reviews/records.ndjson": `${JSON.stringify({ key: "r1", fields: { subject: "Hi" } })}\n`,
    "content/kelly-email-app/_node.json": JSON.stringify({ type: "airapp", name: "Kelly Email" }),
    "content/kelly-email-app/package.json": APP_PACKAGE_JSON,
    "content/kelly-email-app/server.js": "// hono server\n",
  };
  const merged = { ...base, ...overrides };
  const files: PackageFiles = new Map();
  for (const [path, contents] of Object.entries(merged)) {
    if (contents === null) continue;
    files.set(path, utf8(contents));
  }
  return files;
};

const validate = (overrides: Record<string, string | null> = {}) =>
  validateTemplate(readPackageTree(templateFiles(overrides)));

describe("validateTemplate — the happy path", () => {
  it("accepts a complete template and resolves its primary AirApp", () => {
    const result = validate();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.primaryAirApp).toBe("kelly-email-app");
    expect(result.template?.category).toBe("email");
  });

  it("lifts the root skill (entry + sidecars) out of the package root", () => {
    const tree = readPackageTree(templateFiles());
    expect(tree.rootSkill?.slug).toBe("kelly-email");
    expect(tree.rootSkill?.name).toBe("kelly-email");
    // Sorted with localeCompare, so `references/` precedes `SKILL.md`. The
    // property that matters is that the order is deterministic, which is what
    // keeps a re-export byte-identical.
    expect(tree.rootSkill?.files.map((file) => file.path)).toEqual([
      "references/schema.md",
      "scripts/setup.mjs",
      "SKILL.md",
    ]);
    // The root skill is NOT a node under content/ — that is what keeps the
    // round trip from duplicating it.
    expect(tree.nodes.map((node) => node.slug)).toEqual(["kelly-email-app", "reviews"]);
  });
});

describe("validateTemplate — hard conditions", () => {
  it("says a package with no root SKILL.md is simply a plain package", () => {
    const result = validate({ "SKILL.md": null });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("plain package");
  });

  it("requires the explicit template:true opt-in", () => {
    const result = validate({
      "SKILL.md": SKILL_MD.replace("    template: true\n", ""),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("metadata.busabase.template: true");
  });

  it("requires the manifest to carry a template object", () => {
    const result = validate({
      "busabase.json": JSON.stringify({
        format: PACKAGE_FORMAT,
        name: "kelly-email",
        description: "Inbox triage desk",
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("no `template` object");
  });

  it("rejects a name mismatch between the skill and the manifest", () => {
    const result = validate({
      "SKILL.md": SKILL_MD.replace("name: kelly-email", "name: kelly-mail"),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("Name mismatch");
  });

  it("rejects a manual that names a resource content/ does not have", () => {
    const result = validate({ "SKILL.md": SKILL_MD.replace("- reviews", "- ghosts") });
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('lists resource "ghosts"');
  });

  it("rejects an AirApp with no dev script, because it would install then never boot", () => {
    const result = validate({
      "content/kelly-email-app/package.json": JSON.stringify({
        name: "kelly-email-app",
        scripts: { start: "node server.js" },
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("`dev` script");
  });

  it("refuses to guess between two undeclared AirApps", () => {
    const result = validate({
      "busabase.json": JSON.stringify({
        format: PACKAGE_FORMAT,
        name: "kelly-email",
        template: { category: "email" },
      }),
      "content/admin/_node.json": JSON.stringify({ type: "airapp", name: "Admin" }),
      "content/admin/package.json": JSON.stringify({ name: "admin", scripts: { dev: "node ." } }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("declare which one is primary");
  });

  it("caps sample records per Base", () => {
    const lines = Array.from({ length: 51 }, (_, index) =>
      JSON.stringify({ key: `r${index}`, fields: { subject: "x" } }),
    ).join("\n");
    const result = validate({ "content/reviews/records.ndjson": `${lines}\n` });
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("above the 50 per-Base limit");
  });
});

describe("validateTemplate — soft conditions still install", () => {
  it("warns but accepts a data-only template", () => {
    const result = validate({
      "busabase.json": JSON.stringify({
        format: PACKAGE_FORMAT,
        name: "kelly-email",
        template: { category: "email" },
      }),
      "content/kelly-email-app/_node.json": null,
      "content/kelly-email-app/package.json": null,
      "content/kelly-email-app/server.js": null,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.join()).toContain("installs data only");
    expect(result.primaryAirApp).toBeUndefined();
  });

  it("warns about a missing sample dataset, screenshots and prompts", () => {
    const result = validate({
      "content/reviews/records.ndjson": null,
      "busabase.json": JSON.stringify({
        format: PACKAGE_FORMAT,
        name: "kelly-email",
        template: { category: "email", airapp: "kelly-email-app" },
      }),
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.join()).toContain("empty on first open");
    expect(result.warnings.join()).toContain("placeholder");
    expect(result.warnings.join()).toContain("Ask agent");
  });

  it("turns requires.airapp into a hard error when no AirApp ships", () => {
    const result = validate({
      "busabase.json": JSON.stringify({
        format: PACKAGE_FORMAT,
        name: "kelly-email",
        template: { category: "email", requires: { airapp: true } },
      }),
      "content/kelly-email-app/_node.json": null,
      "content/kelly-email-app/package.json": null,
      "content/kelly-email-app/server.js": null,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("requires.airapp");
  });
});

describe("deriveSkillDraft", () => {
  const withoutSkill = () =>
    readPackageTree(
      templateFiles({
        "SKILL.md": null,
        "references/schema.md": null,
        "scripts/setup.mjs": null,
        "busabase.json": JSON.stringify({
          format: PACKAGE_FORMAT,
          name: "kelly-email",
          // A colon in free text is ordinary — and unquoted it turns this line
          // into a nested mapping, making the whole draft unparseable. The
          // generated draft must survive it.
          description: "Inbox triage: drafts and approvals",
          template: { category: "email", airapp: "kelly-email-app" },
        }),
      }),
    );

  it("produces a draft that validates as a template", () => {
    const tree = withoutSkill();
    const draft = deriveSkillDraft(tree);
    tree.rootSkill = {
      slug: "kelly-email",
      name: "kelly-email",
      description: "",
      files: [{ path: "SKILL.md", bytes: utf8(draft) }],
    };
    const result = validateTemplate(tree);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("names the tables that exist and leaves the judgements as TODOs", () => {
    const draft = deriveSkillDraft(withoutSkill());
    expect(draft).toContain('- "reviews"');
    expect(draft).toContain("TODO");
    // Never invented: the draft must not assert what the app does.
    expect(draft).toContain("kelly-email-app");
  });
});

describe("round trip", () => {
  it("carries every root-skill and AirApp file through byte-for-byte", () => {
    const files = templateFiles();
    const rendered = renderPackageTree(readPackageTree(files));
    // JSON the writer owns (`busabase.json`, `base.json`) is re-serialized in a
    // canonical shape, so it is compared semantically. Everything the AUTHOR
    // owns — the manual, its references, the app's own source — must survive
    // untouched, which is the property that makes the skill round-trippable.
    for (const path of [
      "SKILL.md",
      "references/schema.md",
      "scripts/setup.mjs",
      "content/kelly-email-app/server.js",
      "content/kelly-email-app/package.json",
      "content/reviews/records.ndjson",
    ]) {
      expect(rendered.get(path)?.toString("utf8")).toBe(files.get(path)?.toString("utf8"));
    }
    expect(JSON.parse(rendered.get("busabase.json")?.toString("utf8") ?? "{}")).toMatchObject(
      JSON.parse(files.get("busabase.json")?.toString("utf8") ?? "{}"),
    );
  });

  it("keeps the skill at the root on re-render, never under content/", () => {
    const rendered = renderPackageTree(readPackageTree(templateFiles()));
    expect(rendered.has("SKILL.md")).toBe(true);
    expect([...rendered.keys()].some((path) => path.startsWith("content/kelly-email/"))).toBe(
      false,
    );
  });

  it("survives two round trips unchanged (no accumulation)", () => {
    const once = renderPackageTree(readPackageTree(templateFiles()));
    const twice = renderPackageTree(readPackageTree(once));
    expect([...twice.keys()].sort()).toEqual([...once.keys()].sort());
    for (const [path, bytes] of once) {
      expect(twice.get(path)?.toString("utf8")).toBe(bytes.toString("utf8"));
    }
  });

  it("leaves a plain package's manifest free of a template key", () => {
    const plain = templateFiles({
      "SKILL.md": null,
      "references/schema.md": null,
      "scripts/setup.mjs": null,
      "busabase.json": JSON.stringify({ format: PACKAGE_FORMAT, name: "plain" }),
    });
    const rendered = renderPackageTree(readPackageTree(plain));
    expect(rendered.get("busabase.json")?.toString("utf8")).not.toContain("template");
  });
});

describe(".busabaseignore", () => {
  it("keeps ignored files out of the installed AirApp but leaves the repo alone", () => {
    const files = templateFiles({
      "content/kelly-email-app/.busabaseignore": "test/\n*.log\n",
      "content/kelly-email-app/test/email.test.mjs": "// unit test\n",
      "content/kelly-email-app/debug.log": "noise\n",
    });
    const tree = readPackageTree(files);
    const app = tree.nodes.find((node) => node.slug === "kelly-email-app");
    if (app?.type !== "airapp") throw new Error("expected the AirApp node");
    expect(app.files.map((file) => file.path).sort()).toEqual(["package.json", "server.js"]);
  });

  it("refuses an ignore file that would strip package.json", () => {
    expect(() =>
      readPackageTree(
        templateFiles({ "content/kelly-email-app/.busabaseignore": "package.json\n" }),
      ),
    ).toThrow(/must never exclude it/);
  });
});
