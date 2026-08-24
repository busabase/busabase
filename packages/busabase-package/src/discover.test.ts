import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import { discoverPackages, resolvePackageToInstall } from "./discover";
import type { PackageFiles } from "./layout-read";

const utf8 = (text: string) => Buffer.from(text, "utf8");

const skillMd = (name: string) => `---
name: ${name}
description: The ${name} desk.
metadata:
  busabase:
    template: true
---

# ${name}
`;

const manifest = (name: string, template = true) =>
  JSON.stringify({
    format: PACKAGE_FORMAT,
    name,
    description: `The ${name} desk.`,
    ...(template ? { template: { category: "ops" } } : {}),
  });

const baseJson = JSON.stringify({
  name: "Settings",
  fields: [{ slug: "kind", name: "Kind", type: "text", position: 0 }],
});

/** A repository shaped like `busabase/skills`: nothing at the root, packages under `skills/*`. */
const skillsRepo = (extra: Record<string, string> = {}): PackageFiles => {
  const files: PackageFiles = new Map();
  for (const [path, contents] of Object.entries({
    "README.md": "# Skills\n",
    "skills/kelly-email/SKILL.md": skillMd("kelly-email"),
    "skills/kelly-email/busabase.json": manifest("kelly-email"),
    "skills/kelly-email/content/settings/base.json": baseJson,
    "skills/kelly-crm/SKILL.md": skillMd("kelly-crm"),
    "skills/kelly-crm/busabase.json": manifest("kelly-crm"),
    "skills/kelly-crm/content/contacts/base.json": baseJson,
    ...extra,
  })) {
    files.set(path, utf8(contents));
  }
  return files;
};

const singlePackage = (): PackageFiles =>
  new Map([
    ["busabase.json", utf8(manifest("support-kb", false))],
    ["content/faq.md", utf8("---\nname: FAQ\n---\n\nHello.\n")],
  ]);

describe("discoverPackages", () => {
  it("finds every package under a skills-style repository", () => {
    const found = discoverPackages(skillsRepo());
    expect(found.map((entry) => entry.subdir)).toEqual(["skills/kelly-crm", "skills/kelly-email"]);
    expect(found.every((entry) => entry.isTemplate)).toBe(true);
    expect(found[0].counts.bases).toBe(1);
  });

  it("finds the repository itself when it is the package", () => {
    const found = discoverPackages(singlePackage());
    expect(found).toHaveLength(1);
    expect(found[0].subdir).toBe("");
    expect(found[0].isTemplate).toBe(false);
  });

  it("stays quiet about a plain package rather than listing it as broken", () => {
    // Not being a template is not a defect — only a failed CLAIM is.
    expect(discoverPackages(singlePackage())[0].templateErrors).toEqual([]);
  });

  it("explains itself to an author whose template does not quite validate", () => {
    const files = skillsRepo();
    files.set("skills/kelly-email/busabase.json", utf8(manifest("wrong-name")));
    const entry = discoverPackages(files).find((item) => item.subdir === "skills/kelly-email");
    expect(entry?.isTemplate).toBe(false);
    expect(entry?.templateErrors.join()).toContain("Name mismatch");
  });

  it("skips an unreadable package instead of failing the whole repository", () => {
    const files = skillsRepo({ "skills/broken/busabase.json": "{ not json" });
    const found = discoverPackages(files);
    expect(found.map((entry) => entry.name).sort()).toEqual(["kelly-crm", "kelly-email"]);
  });

  it("does not descend into vendored copies", () => {
    const files = skillsRepo({
      "skills/kelly-email/node_modules/dep/busabase.json": manifest("dep", false),
    });
    expect(
      discoverPackages(files)
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(["kelly-crm", "kelly-email"]);
  });
});

describe("resolvePackageToInstall", () => {
  it("installs the root package without asking", () => {
    const resolved = resolvePackageToInstall(singlePackage());
    expect(resolved).toMatchObject({ kind: "package", subdir: "" });
  });

  it("asks which one when a repository holds several", () => {
    const resolved = resolvePackageToInstall(skillsRepo());
    expect(resolved.kind).toBe("choose");
    if (resolved.kind !== "choose") return;
    expect(resolved.candidates).toHaveLength(2);
  });

  it("takes the only one without asking", () => {
    const files = skillsRepo();
    for (const key of [...files.keys()]) {
      if (key.startsWith("skills/kelly-crm/")) files.delete(key);
    }
    expect(resolvePackageToInstall(files)).toMatchObject({
      kind: "package",
      subdir: "skills/kelly-email",
    });
  });

  it("matches a chosen package by name", () => {
    expect(resolvePackageToInstall(skillsRepo(), "kelly-crm")).toMatchObject({
      kind: "package",
      subdir: "skills/kelly-crm",
    });
  });

  it("matches by subdir too, since a user reading a repo sees directories", () => {
    expect(resolvePackageToInstall(skillsRepo(), "skills/kelly-crm")).toMatchObject({
      kind: "package",
      subdir: "skills/kelly-crm",
    });
  });

  it("falls back to the list when the chosen name is not there", () => {
    expect(resolvePackageToInstall(skillsRepo(), "kelly-ghost").kind).toBe("choose");
  });

  it("prefers the repository's own package over the ones it vendors", () => {
    const files = skillsRepo();
    files.set("busabase.json", utf8(manifest("the-repo-itself", false)));
    expect(resolvePackageToInstall(files)).toMatchObject({ kind: "package", subdir: "" });
  });

  it("reports nothing found for a repository with no packages at all", () => {
    const files: PackageFiles = new Map([["README.md", utf8("# nothing here\n")]]);
    expect(resolvePackageToInstall(files)).toEqual({ kind: "none" });
  });
});
