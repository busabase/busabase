/**
 * Planning a template: Base-slug prefixing, the resourceKey map that survives
 * it, and the auto-merge gate that must NOT fire for templates.
 */

import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import { type PackageFiles, readPackageTree } from "./layout-read";
import { buildInstallPlan, type TargetState } from "./plan";
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
