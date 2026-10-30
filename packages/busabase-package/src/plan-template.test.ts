/**
 * Planning a template: Base-slug prefixing, the resourceKey map that survives
 * it, and the auto-merge gate that must NOT fire for templates.
 */

import { PACKAGE_FORMAT, PACKAGE_MAX_FILE_COUNT } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import { type PackageFiles, readPackageTree } from "./layout-read";
import { buildInstallPlan, countTree, renderPlan, type TargetState } from "./plan";
import { collectBaseNodes } from "./tree";

const SKILL_MD = `---
name: kelly-email
description: Inbox triage desk.
metadata:
  busabase:
    template: true
---

# Kelly Email
`;

const base = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    name,
    fields: [{ slug: "subject", name: "Subject", type: "text", position: 0 }],
    ...extra,
  });

const files = (overrides: Record<string, string | null> = {}): PackageFiles => {
  const defaults: Record<string, string> = {
    "SKILL.md": SKILL_MD,
    "busabase.json": JSON.stringify({
      format: PACKAGE_FORMAT,
      name: "kelly-email",
      template: { category: "email" },
    }),
    "content/reviews/base.json": base("Email Reviews"),
    "content/settings/base.json": base("Settings"),
  };
  const map: PackageFiles = new Map();
  for (const [path, contents] of Object.entries({ ...defaults, ...overrides })) {
    if (contents !== null) map.set(path, Buffer.from(contents, "utf8"));
  }
  return map;
};

const emptyTarget: TargetState = {
  targetFolder: undefined,
  existingNodeSlugsByType: new Map(),
};

const plan = (overrides: Record<string, string | null> = {}, options = {}) =>
  buildInstallPlan(readPackageTree(files(overrides)), emptyTarget, options);

const slugs = (result: ReturnType<typeof plan>) =>
  collectBaseNodes(result.tree.nodes)
    .map((node) => node.slug)
    .sort();

describe("root Skill counts", () => {
  it("includes a template's root Skill and sidecar files without any content nodes", () => {
    const result = plan({
      "content/reviews/base.json": null,
      "content/settings/base.json": null,
      "references/workflow.md": "# Workflow\n",
      "scripts/check.mjs": "console.log('check');\n",
    });

    expect(result.isTemplate).toBe(true);
    expect(result.counts).toMatchObject({ bases: 0, skills: 1, files: 3 });
    expect(renderPlan(result)).toContain("1 skill(s), 0 airapp(s), 0 drive(s), 3 file(s)");
    expect(countTree(readPackageTree(files())).skills).toBe(1);
  });

  it("adds nested Skills and their files without counting the root twice", () => {
    const result = plan({
      "content/guides/_folder.json": JSON.stringify({ name: "Guides" }),
      "content/guides/research/_node.json": JSON.stringify({ type: "skill", name: "Research" }),
      "content/guides/research/SKILL.md": "---\nname: research\ndescription: Research.\n---\n",
      "content/guides/research/references/search.md": "# Search\n",
      "references/workflow.md": "# Workflow\n",
    });

    expect(result.counts).toMatchObject({ folders: 1, skills: 2, files: 4 });
  });

  it("keeps the original template decision after Base slugs are prefixed", () => {
    const result = plan({
      "SKILL.md": SKILL_MD.replace(
        "    template: true",
        "    template: true\n    resources: [reviews]",
      ),
    });

    expect(slugs(result)).toContain("kelly-email-reviews");
    expect(result.isTemplate).toBe(true);
    expect(result.counts).toMatchObject({ skills: 1, files: 1 });
  });

  it.each([
    ["missing opt-in", SKILL_MD.replace("    template: true", "    template: false")],
    ["invalid identity", SKILL_MD.replace("name: kelly-email", "name: another-template")],
  ])("does not count a root Skill that will not be installed (%s)", (_, skill) => {
    const packageFiles = files({
      "SKILL.md": skill,
      "content/helper/_node.json": JSON.stringify({ type: "skill", name: "Helper" }),
      "content/helper/SKILL.md": "---\nname: helper\ndescription: Helper.\n---\n",
    });
    const tree = readPackageTree(packageFiles);
    const result = buildInstallPlan(tree, emptyTarget);

    expect(tree.rootSkill).toBeDefined();
    expect(result.isTemplate).toBe(false);
    expect(result.counts).toMatchObject({ skills: 1, files: 1 });
    expect(countTree(tree)).toEqual(result.counts);
  });

  it("enforces the file limit across root Skill and node files together", () => {
    const packageFiles = files();
    packageFiles.set(
      "content/manual/_node.json",
      Buffer.from(JSON.stringify({ type: "skill", name: "Manual" })),
    );
    for (let index = 0; index < PACKAGE_MAX_FILE_COUNT - 1; index++) {
      packageFiles.set(`content/manual/notes/${index}.md`, Buffer.from("note"));
    }
    packageFiles.set("content/manual/SKILL.md", Buffer.from("# Manual\n"));

    expect(() => buildInstallPlan(readPackageTree(packageFiles), emptyTarget)).toThrow(
      `Package has ${PACKAGE_MAX_FILE_COUNT + 1} files, above the ${PACKAGE_MAX_FILE_COUNT}-file limit. Nothing was installed.`,
    );
    packageFiles.delete("content/manual/notes/0.md");
    expect(buildInstallPlan(readPackageTree(packageFiles), emptyTarget).counts.files).toBe(
      PACKAGE_MAX_FILE_COUNT,
    );
  });
});

describe("Base-slug prefixing", () => {
  it("prefixes a template's Bases with the target folder", () => {
    // Base slugs are unique per SPACE, and every template has a `settings`.
    expect(slugs(plan())).toEqual(["kelly-email-reviews", "kelly-email-settings"]);
  });

  it("leaves a plain package's slugs exactly as the author wrote them", () => {
    const result = plan({
      "SKILL.md": null,
      "busabase.json": JSON.stringify({ format: PACKAGE_FORMAT, name: "kelly-email" }),
    });
    expect(slugs(result)).toEqual(["reviews", "settings"]);
    expect(result.isTemplate).toBe(false);
  });

  it("follows the prefix through relation targets, so links still resolve", () => {
    const result = plan({
      "content/reviews/base.json": JSON.stringify({
        name: "Email Reviews",
        fields: [
          {
            slug: "setting",
            name: "Setting",
            type: "relation",
            position: 0,
            options: { targetBaseSlug: "settings" },
          },
        ],
      }),
    });
    const reviews = collectBaseNodes(result.tree.nodes).find(
      (node) => node.slug === "kelly-email-reviews",
    );
    expect(reviews?.base.fields[0].options.targetBaseSlug).toBe("kelly-email-settings");
  });

  it("does not stack the prefix when a slug already carries it", () => {
    const result = plan({
      "content/reviews/base.json": null,
      "content/settings/base.json": null,
      "content/kelly-email-reviews/base.json": base("Email Reviews"),
    });
    expect(slugs(result)).toEqual(["kelly-email-reviews"]);
  });

  it("honours an explicit opt-out", () => {
    expect(slugs(plan({}, { prefixBaseSlugs: false }))).toEqual(["reviews", "settings"]);
  });

  it("prefixes against the chosen target folder, not the manifest name", () => {
    expect(slugs(plan({}, { intoFolder: "inbox" }))).toEqual(["inbox-reviews", "inbox-settings"]);
  });
});

describe("resourceKeysBySlug", () => {
  it("maps every installed slug back to the one the package declared", () => {
    // This is what the ownership stamp records: the app looks its Base up by
    // `reviews`, wherever it happened to be installed.
    expect(plan().resourceKeysBySlug["kelly-email-reviews"]).toBe("reviews");
  });

  it("still points at the package's slug after a rename layers on top", () => {
    const target: TargetState = {
      targetFolder: undefined,
      existingNodeSlugsByType: new Map([["base", new Set(["kelly-email-reviews"])]]),
    };
    const result = buildInstallPlan(readPackageTree(files()), target, { rename: true });
    const renamed = collectBaseNodes(result.tree.nodes).map((node) => node.slug);
    expect(renamed).toContain("kelly-email-reviews-2");
    expect(result.resourceKeysBySlug["kelly-email-reviews-2"]).toBe("reviews");
  });
});

describe("the auto-merge gate", () => {
  const withRelationValue = {
    "content/reviews/base.json": JSON.stringify({
      name: "Email Reviews",
      fields: [
        {
          slug: "setting",
          name: "Setting",
          type: "relation",
          position: 0,
          options: { targetBaseSlug: "settings" },
        },
      ],
    }),
    "content/reviews/records.ndjson": `${JSON.stringify({ key: "r1", fields: { setting: ["s1"] } })}\n`,
  };

  it("does not force a template into a review-free install", () => {
    // A template merges its own sample rows, so pass 5 has ids to link. Forcing
    // `--auto-merge` here would also merge the AirApp code, which must stay in
    // review — the gate would push the user into the exact thing it protects.
    expect(plan(withRelationValue).requiresAutoMerge).toBe(false);
  });

  it("still forces it when the samples are not being installed", () => {
    expect(plan(withRelationValue, { installSampleRecords: false }).requiresAutoMerge).toBe(true);
  });

  it("still forces it for a plain package, as before", () => {
    const result = plan({
      ...withRelationValue,
      "SKILL.md": null,
      "busabase.json": JSON.stringify({ format: PACKAGE_FORMAT, name: "kelly-email" }),
    });
    expect(result.requiresAutoMerge).toBe(true);
  });
});
