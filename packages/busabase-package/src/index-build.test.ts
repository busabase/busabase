/**
 * Building the catalog from a repository of packages: which entries make it
 * in, and which of the package's own fields (including declared `risk`) ride
 * along to the browser-facing `TemplateIndexEntry`.
 */

import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import { buildTemplateIndex } from "./index-build";
import type { PackageFiles } from "./layout-read";

const utf8 = (text: string) => Buffer.from(text, "utf8");

const skillMd = (name: string, risk?: string) => `---
name: ${name}
description: The ${name} desk.
metadata:
  busabase:
    template: true
${risk ? `    risk: ${risk}\n` : ""}---

# ${name}
`;

const manifest = (name: string) =>
  JSON.stringify({
    format: PACKAGE_FORMAT,
    name,
    description: `The ${name} desk.`,
    template: { category: "ops" },
  });

const repo = (extra: Record<string, string> = {}): PackageFiles => {
  const files: PackageFiles = new Map();
  for (const [path, contents] of Object.entries({
    "templates/gated/SKILL.md": skillMd("gated", "gated-write"),
    "templates/gated/busabase.json": manifest("gated"),
    "templates/gated/content/settings/base.json": JSON.stringify({
      name: "Settings",
      fields: [{ slug: "kind", name: "Kind", type: "text", position: 0 }],
    }),
    ...extra,
  })) {
    files.set(path, utf8(contents));
  }
  return files;
};

describe("buildTemplateIndex", () => {
  it("carries a recognized declared risk level onto the index entry", () => {
    const index = buildTemplateIndex(repo(), { repo: "busabase/templates", ref: "main" });
    expect(index.templates).toHaveLength(1);
    expect(index.templates[0].risk).toBe("gated-write");
  });

  it("omits risk entirely rather than emitting an unrecognized value", () => {
    const index = buildTemplateIndex(
      repo({ "templates/gated/SKILL.md": skillMd("gated", "review-first") }),
      { repo: "busabase/templates", ref: "main" },
    );
    expect(index.templates).toHaveLength(1);
    expect(index.templates[0].risk).toBeUndefined();
    expect(Object.hasOwn(index.templates[0], "risk")).toBe(false);
  });

  it("omits risk when the manual never declares one", () => {
    const index = buildTemplateIndex(repo({ "templates/gated/SKILL.md": skillMd("gated") }), {
      repo: "busabase/templates",
      ref: "main",
    });
    expect(index.templates[0].risk).toBeUndefined();
  });
});
