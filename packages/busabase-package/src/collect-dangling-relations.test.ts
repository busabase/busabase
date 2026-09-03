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

  it("relaxes a REQUIRED relation the drop emptied, so the package can still be installed", () => {
    // The real failure this exists for: on the production space a record's
    // `project` pointed at a row archived on 2026-08-24. Archived rows are not
    // exported, so the value was dropped — leaving a `required` relation empty,
    // which `record-dependencies.ts` rejects with "is missing required
    // relation. Nothing was installed." The export succeeded and produced a
    // package that could not be installed anywhere, including back into the
    // space it came from.
    const required = { ...relationField("project", "video-projects"), required: true };
    const artifacts = baseNode("artifacts", {
      base: { name: "artifacts", description: "", fields: [required], views: [] },
      records: [
        // Emptied by the drop — this is what breaks install.
        { key: "rec-artifact-1", fields: { project: ["rec-project-archived"] } },
        // Still resolvable; must not be disturbed.
        { key: "rec-artifact-2", fields: { project: ["rec-project-live"] } },
      ],
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

    // The constraint is relaxed IN THE PACKAGE — that is what makes it
    // installable — while the surviving value is untouched.
    expect(artifacts.base.fields[0].required).toBe(false);
    expect(artifacts.records[0].fields.project).toEqual([]);
    expect(artifacts.records[1].fields.project).toEqual(["rec-project-live"]);
    // And it says so, naming the field and how many records are affected.
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain('relation field "project" is required in the source');
    expect(warnings[1]).toContain("1 record(s)");
    expect(warnings[1]).toContain("NOT required in this package");
  });

  it("relaxes a REQUIRED attachment field, which this format can never carry a value for", () => {
    // Same class of bug as the relation case, but unconditional: the format
    // carries field definitions, never attachment bytes, so a required
    // attachment column is empty in every exported record by construction.
    // The real install died after creating 2,903 records with
    // `Invalid field value: 文件 is required`.
    const attachment = {
      slug: "file",
      name: "文件",
      type: "attachment" as const,
      required: true,
      position: 0,
      options: {},
    };
    const artifacts = baseNode("artifacts", {
      base: { name: "artifacts", description: "", fields: [attachment], views: [] },
      records: [{ key: "rec-1", fields: {} }],
    });
    const tree: PackageTree = { manifest: manifest(), nodes: [artifacts] };

    const warnings: string[] = [];
    assertSelfContained(tree, {
      manifest: manifest(),
      warn: (m) => warnings.push(m),
      baseUrl: "http://localhost",
    });

    expect(artifacts.base.fields[0].required).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('attachment field "file" is required in the source');
    expect(warnings[0]).toContain("never carries attachment values");
  });

  it("leaves an optional attachment field untouched", () => {
    const attachment = {
      slug: "file",
      name: "文件",
      type: "attachment" as const,
      required: false,
      position: 0,
      options: {},
    };
    const artifacts = baseNode("artifacts", {
      base: { name: "artifacts", description: "", fields: [attachment], views: [] },
      records: [{ key: "rec-1", fields: {} }],
    });
    const tree: PackageTree = { manifest: manifest(), nodes: [artifacts] };

    const warnings: string[] = [];
    assertSelfContained(tree, {
      manifest: manifest(),
      warn: (m) => warnings.push(m),
      baseUrl: "http://localhost",
    });

    expect(artifacts.base.fields[0].required).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("leaves a required relation alone when nothing was dropped from it", () => {
    const required = { ...relationField("project", "video-projects"), required: true };
    const artifacts = baseNode("artifacts", {
      base: { name: "artifacts", description: "", fields: [required], views: [] },
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

    expect(artifacts.base.fields[0].required).toBe(true);
    expect(warnings).toEqual([]);
  });
});
