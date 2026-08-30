/**
 * `assertSelfContained` claims a dangling relation value — one pointing at a
 * record that isn't in the package (commonly: archived, so excluded from
 * `records.ndjson` even though its Base IS in the package) — "was dropped".
 * Regression coverage for the bug where it only counted and warned, never
 * actually removing the key from `record.fields`, so the archive still shipped
 * exactly the reference the warning said was gone. `install` then failed with
 * "Nothing was installed" on a package `export` had just called self-contained.
 */
import { PACKAGE_FORMAT, type PackageManifest } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import { assertSelfContained } from "./collect";
import type { PackageBaseNode, PackageTree } from "./tree";

const manifest = (): PackageManifest => ({
  format: PACKAGE_FORMAT,
  name: "test",
  description: "",
  tags: [],
});

const relationField = (slug: string, targetBaseSlug: string) => ({
  slug,
  name: slug,
  type: "relation" as const,
  required: false,
  position: 0,
  options: { targetBaseSlug },
});

const baseNode = (slug: string, node: Partial<PackageBaseNode>): PackageBaseNode => ({
  slug,
  name: slug,
  description: "",
  position: 0,
  type: "base",
  base: { name: slug, description: "", fields: [], views: [] },
  records: [],
  ...node,
});

describe("assertSelfContained — dangling same-package relations", () => {
  it("actually removes a relation value pointing at a record excluded from the package (e.g. archived)", () => {
    const artifacts = baseNode("artifacts", {
      base: {
        name: "artifacts",
        description: "",
        fields: [relationField("project", "video-projects")],
        views: [],
      },
      records: [
        {
          key: "rec-artifact-1",
          fields: { project: ["rec-project-archived", "rec-project-live"] },
        },
      ],
    });
    const videoProjects = baseNode("video-projects", {
      records: [{ key: "rec-project-live", fields: {} }],
      // "rec-project-archived" deliberately absent — the archived-record case.
    });
    const tree: PackageTree = { manifest: manifest(), nodes: [artifacts, videoProjects] };

    const warnings: string[] = [];
    assertSelfContained(tree, {
      manifest: manifest(),
      warn: (m) => warnings.push(m),
      baseUrl: "http://localhost",
    });

    // The dangling key is gone; the still-valid one survives.
    expect(artifacts.records[0].fields.project).toEqual(["rec-project-live"]);
    expect(warnings).toEqual([
      'Base "artifacts" has 1 relation value(s) pointing at records outside the exported subtree — they were dropped.',
    ]);
  });

  it("drops every value and leaves an empty array when none of them resolve", () => {
    const artifacts = baseNode("artifacts", {
      base: {
        name: "artifacts",
        description: "",
        fields: [relationField("project", "video-projects")],
        views: [],
      },
      records: [{ key: "rec-artifact-1", fields: { project: ["rec-gone-1", "rec-gone-2"] } }],
    });
    const videoProjects = baseNode("video-projects", { records: [] });
    const tree: PackageTree = { manifest: manifest(), nodes: [artifacts, videoProjects] };

    assertSelfContained(tree, {
      manifest: manifest(),
      warn: () => {},
      baseUrl: "http://localhost",
    });

    expect(artifacts.records[0].fields.project).toEqual([]);
  });

  it("leaves a fully-resolved relation untouched and warns nothing", () => {
    const artifacts = baseNode("artifacts", {
      base: {
        name: "artifacts",
        description: "",
        fields: [relationField("project", "video-projects")],
        views: [],
      },
      records: [{ key: "rec-artifact-1", fields: { project: ["rec-project-live"] } }],
    });
    const videoProjects = baseNode("video-projects", {
      records: [{ key: "rec-project-live", fields: {} }],
    });
    const tree: PackageTree = { manifest: manifest(), nodes: [artifacts, videoProjects] };

    const warnings: string[] = [];
    assertSelfContained(tree, {
      manifest: manifest(),
      warn: (m) => warnings.push(m),
      baseUrl: "http://localhost",
    });

    expect(artifacts.records[0].fields.project).toEqual(["rec-project-live"]);
    expect(warnings).toEqual([]);
  });
});
