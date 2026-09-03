import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import {
  assertPlanIsApplicable,
  buildInstallPlan,
  type ExistingNode,
  findPlanBlockers,
} from "./plan";
import type { PackageBaseNode, PackageTree } from "./tree";

const baseNode = (
  slug: string,
  fields: PackageBaseNode["base"]["fields"] = [],
  records: PackageBaseNode["records"] = [],
): PackageBaseNode => ({
  type: "base",
  slug,
  name: slug,
  description: "",
  position: 0,
  base: { name: slug, description: "", position: 0, fields, views: [] },
  records,
});

const tree = (nodes: PackageTree["nodes"]): PackageTree => ({
  manifest: { format: PACKAGE_FORMAT, name: "my-package", description: "", tags: [] },
  nodes,
});

const targetState = (existingByType: Record<string, string[]> = {}) => ({
  targetFolder: undefined,
  existingNodeSlugsByType: new Map(
    Object.entries(existingByType).map(([type, slugs]) => [type, new Set(slugs)]),
  ),
});

const noTarget = targetState();

const relationField = (slug: string, targetBaseSlug: string) => ({
  slug,
  name: slug,
  type: "relation" as const,
  required: false,
  position: 0,
  options: { targetBaseSlug },
});

describe("collision detection", () => {
  it("reports a node slug colliding with an existing child of the target folder", () => {
    const targetFolder: ExistingNode = {
      id: "nod_1",
      slug: "my-package",
      type: "folder",
      children: [{ id: "nod_2", slug: "guides", type: "folder" }],
    };
    const plan = buildInstallPlan(
      tree([
        {
          type: "folder",
          slug: "guides",
          name: "Guides",
          description: "",
          position: 0,
          children: [],
        },
      ]),
      {
        targetFolder,
        existingNodeSlugsByType: new Map([["folder", new Set(["guides"])]]),
      },
    );
    expect(plan.collisions).toEqual([
      {
        kind: "node",
        nodeType: "folder",
        slug: "guides",
        path: "my-package/…/guides (folder slugs are unique per space)",
      },
    ]);
  });

  it("reports a base slug colliding ANYWHERE in the space, not just the target folder", () => {
    // Every node type is unique by slug per space. A base in an unrelated
    // folder therefore still collides.
    const plan = buildInstallPlan(tree([baseNode("products")]), {
      ...targetState({ base: ["products"] }),
    });
    expect(plan.collisions).toMatchObject([{ kind: "base", slug: "products" }]);
  });

  it("finds a nested base's space-wide collision even though it is not a top-level node", () => {
    const plan = buildInstallPlan(
      tree([
        {
          type: "folder",
          slug: "data",
          name: "Data",
          description: "",
          position: 0,
          children: [baseNode("products")],
        },
      ]),
      targetState({ base: ["products"] }),
    );
    expect(plan.collisions).toMatchObject([{ kind: "base", slug: "products" }]);
  });

  it("reports no collision for a clean install", () => {
    expect(buildInstallPlan(tree([baseNode("products")]), noTarget).collisions).toEqual([]);
  });

  it("does not collide with the same slug on a different node type", () => {
    expect(
      buildInstallPlan(tree([baseNode("products")]), targetState({ form: ["products"] }))
        .collisions,
    ).toEqual([]);
  });

  it("rejects duplicate same-type slugs inside the package, including nested nodes", () => {
    expect(() =>
      buildInstallPlan(
        tree([
          baseNode("products"),
          {
            type: "folder",
            slug: "data",
            name: "Data",
            description: "",
            position: 0,
            children: [baseNode("products")],
          },
        ]),
        noTarget,
      ),
    ).toThrow(/duplicate base slug "products"/i);
  });

  it("fails with every collision listed, and points at --rename", () => {
    const plan = buildInstallPlan(tree([baseNode("products")]), {
      ...targetState({ base: ["products"] }),
    });
    expect(() => assertPlanIsApplicable(plan, true)).toThrow(/--rename/);
    expect(() => assertPlanIsApplicable(plan, true)).toThrow(/products/);
  });
});

describe("findPlanBlockers — required fields the package cannot fill", () => {
  const requiredAttachment = {
    slug: "file",
    name: "文件",
    type: "attachment" as const,
    required: true,
    position: 0,
    options: {},
  };

  it("reports a required field no record carries a value for, before anything is written", () => {
    // The real failure: a package with a REQUIRED attachment field installed
    // fine through planning and died in pass 4 of 5 — `Invalid field value:
    // 文件 is required` — after the server had already created 2,903 records.
    // Planning knows enough to say this up front.
    const plan = buildInstallPlan(
      tree([baseNode("artifacts", [requiredAttachment], [{ key: "rec-1", fields: {} }])]),
      noTarget,
      {},
    );

    const blockers = findPlanBlockers(plan, true);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain('Base "artifacts", field "file" (attachment) is required');
    expect(blockers[0]).toContain("1 of 1 record(s)");
    // And the real install path throws on the same finding.
    expect(() => assertPlanIsApplicable(plan, true)).toThrow(/cannot satisfy its own required/);
  });

  it("counts only the records actually missing a value", () => {
    const plan = buildInstallPlan(
      tree([
        baseNode(
          "artifacts",
          [requiredAttachment],
          [
            { key: "rec-1", fields: { file: [] } }, // empty array counts as missing
            { key: "rec-2", fields: { file: "asset-1" } },
            { key: "rec-3", fields: {} },
          ],
        ),
      ]),
      noTarget,
      {},
    );

    expect(findPlanBlockers(plan, true)[0]).toContain("2 of 3 record(s)");
  });

  it("says nothing when every record satisfies the required field", () => {
    const plan = buildInstallPlan(
      tree([
        baseNode(
          "artifacts",
          [requiredAttachment],
          [{ key: "rec-1", fields: { file: "asset-1" } }],
        ),
      ]),
      noTarget,
      {},
    );

    expect(findPlanBlockers(plan, true)).toEqual([]);
  });

  it("ignores optional fields left empty", () => {
    const optional = { ...requiredAttachment, required: false };
    const plan = buildInstallPlan(
      tree([baseNode("artifacts", [optional], [{ key: "rec-1", fields: {} }])]),
      noTarget,
      {},
    );

    expect(findPlanBlockers(plan, true)).toEqual([]);
  });
});

describe("--rename", () => {
  it("renames a colliding non-base node to keep its type + slug unique in the space", () => {
    const plan = buildInstallPlan(
      tree([
        {
          type: "skill",
          slug: "editor",
          name: "Editor",
          description: "",
          position: 0,
          files: [],
        },
      ]),
      targetState({ skill: ["editor"] }),
      { rename: true },
    );

    expect(plan.collisions[0]).toMatchObject({
      nodeType: "skill",
      slug: "editor",
      renamedTo: "editor-2",
    });
    expect(plan.tree.nodes[0].slug).toBe("editor-2");
  });

  it("renames a colliding base to a free suffixed slug", () => {
    const plan = buildInstallPlan(
      tree([baseNode("products")]),
      targetState({ base: ["products"] }),
      { rename: true },
    );
    expect(plan.collisions[0].renamedTo).toBe("products-2");
    expect(plan.tree.nodes[0].slug).toBe("products-2");
    expect(() => assertPlanIsApplicable(plan, true)).not.toThrow();
  });

  it("skips suffixes that are themselves taken", () => {
    const plan = buildInstallPlan(
      tree([baseNode("products")]),
      targetState({ base: ["products", "products-2", "products-3"] }),
      { rename: true },
    );
    expect(plan.collisions[0].renamedTo).toBe("products-4");
  });

  it("REWRITES targetBaseSlug when the base it points at is renamed", () => {
    // The silent-corruption case: the server resolves targetBaseSlug against active
    // bases in the space. If `vendors.products` still named "products" after the
    // package's own "products" base was renamed to "products-2", the relation would
    // bind to the PRE-EXISTING foreign "products" base — succeeding, with the wrong
    // target, and no error anywhere.
    const plan = buildInstallPlan(
      tree([baseNode("vendors", [relationField("products", "products")]), baseNode("products")]),
      targetState({ base: ["products"] }),
      { rename: true },
    );

    const vendors = plan.tree.nodes[0];
    const products = plan.tree.nodes[1];
    if (vendors.type !== "base" || products.type !== "base") throw new Error("expected bases");
    expect(products.slug).toBe("products-2");
    expect(vendors.base.fields[0].options.targetBaseSlug).toBe("products-2");
  });

  it("leaves a targetBaseSlug alone when its target was not renamed", () => {
    const plan = buildInstallPlan(
      tree([baseNode("vendors", [relationField("products", "products")]), baseNode("products")]),
      targetState({ base: ["vendors"] }),
      { rename: true },
    );
    const vendors = plan.tree.nodes[0];
    if (vendors.type !== "base") throw new Error("expected a base");
    expect(vendors.slug).toBe("vendors-2");
    expect(vendors.base.fields[0].options.targetBaseSlug).toBe("products");
  });

  it("rewrites a renamed base's targetBaseSlug even from a nested base", () => {
    const plan = buildInstallPlan(
      tree([
        {
          type: "folder",
          slug: "data",
          name: "Data",
          description: "",
          position: 0,
          children: [baseNode("vendors", [relationField("products", "products")])],
        },
        baseNode("products"),
      ]),
      targetState({ base: ["products"] }),
      { rename: true },
    );
    const folder = plan.tree.nodes[0];
    if (folder.type !== "folder") throw new Error("expected a folder");
    const vendors = folder.children[0];
    if (vendors.type !== "base") throw new Error("expected a base");
    expect(vendors.base.fields[0].options.targetBaseSlug).toBe("products-2");
  });
});

/**
 * `--auto-merge` is forced by exactly one thing: a relation VALUE, which is the id of
 * another record and therefore doesn't exist until the records are merged. Not by a
 * relation *schema*, and not by an AI field — those are pass-2 *ordering* concerns, and
 * passes 2-3 run against an immediately-created Base either way. Gating on them would
 * push users into waiving review for no reason.
 */
describe("--auto-merge requirement (§12)", () => {
  it("requires --auto-merge when a record carries a relation value", () => {
    const plan = buildInstallPlan(
      tree([
        baseNode(
          "vendors",
          [relationField("products", "products")],
          [{ key: "v1", fields: { products: ["p1"] } }],
        ),
        baseNode("products"),
      ]),
      noTarget,
    );
    expect(plan.requiresAutoMerge).toBe(true);
    expect(() => assertPlanIsApplicable(plan, false)).toThrow(/--auto-merge/);
    expect(() => assertPlanIsApplicable(plan, true)).not.toThrow();
  });

  it("does NOT require --auto-merge for a relation schema with nothing to link", () => {
    const plan = buildInstallPlan(
      tree([
        baseNode(
          "vendors",
          [relationField("products", "products")],
          [{ key: "v1", fields: { products: [] } }],
        ),
        baseNode("products"),
      ]),
      noTarget,
    );
    expect(plan.requiresAutoMerge).toBe(false);
    expect(() => assertPlanIsApplicable(plan, false)).not.toThrow();
  });

  it("does NOT require --auto-merge for AI fields — they need no merged records", () => {
    const plan = buildInstallPlan(
      tree([
        baseNode("posts", [
          {
            slug: "summary",
            name: "Summary",
            type: "ai_summary",
            required: false,
            position: 0,
            options: {},
          },
        ]),
      ]),
      noTarget,
    );
    expect(plan.requiresAutoMerge).toBe(false);
  });

  it("does not require --auto-merge for a plain base", () => {
    const plan = buildInstallPlan(
      tree([
        baseNode("posts", [
          { slug: "title", name: "Title", type: "text", required: true, position: 0, options: {} },
        ]),
      ]),
      noTarget,
    );
    expect(plan.requiresAutoMerge).toBe(false);
    expect(() => assertPlanIsApplicable(plan, false)).not.toThrow();
  });
});

describe("plan reporting", () => {
  it("defaults the target folder to the manifest name (§12)", () => {
    expect(buildInstallPlan(tree([]), noTarget).targetFolderSlug).toBe("my-package");
  });

  it("carries an existing target folder id into the apply plan", () => {
    const targetFolder: ExistingNode = {
      id: "nod_existing_target",
      slug: "my-package",
      type: "folder",
      children: [],
    };
    const plan = buildInstallPlan(tree([]), {
      targetFolder,
      existingNodeSlugsByType: new Map([["folder", new Set(["my-package"])]]),
    });

    expect(plan.existingTargetFolderNodeId).toBe("nod_existing_target");
  });

  it("honors --into-folder", () => {
    expect(buildInstallPlan(tree([]), noTarget, { intoFolder: "support" }).targetFolderSlug).toBe(
      "support",
    );
  });

  it("counts every node type and its records", () => {
    const plan = buildInstallPlan(
      tree([
        baseNode(
          "products",
          [],
          [
            { key: "a", fields: {} },
            { key: "b", fields: {} },
          ],
        ),
        { type: "doc", slug: "faq", name: "FAQ", description: "", position: 1, body: "" },
      ]),
      noTarget,
    );
    expect(plan.counts).toMatchObject({ bases: 1, records: 2, docs: 1 });
  });

  it("warns that reviewPolicy cannot be applied (§6.4)", () => {
    const node = baseNode("products");
    node.base.reviewPolicy = { kind: "single", requiredApprovals: 2 };
    const plan = buildInstallPlan(tree([node]), noTarget);
    expect(plan.warnings.join("\n")).toMatch(/reviewPolicy cannot be set/i);
  });
});
