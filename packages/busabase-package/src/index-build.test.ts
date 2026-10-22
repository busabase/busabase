/**
 * Building the catalog from a repository of packages: which entries make it
 * in, and which of the package's own fields (including declared `risk`) ride
 * along to the browser-facing `TemplateIndexEntry`.
 */

import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import { buildTemplateIndex, renderTemplateIndex } from "./index-build";
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

  it("carries a locale-keyed manifest description onto the index entry untouched", () => {
    const localizedManifest = JSON.stringify({
      format: PACKAGE_FORMAT,
      name: "gated",
      description: { en: "The gated desk.", "zh-CN": "受限工作台。" },
      template: { category: "ops" },
    });
    const index = buildTemplateIndex(repo({ "templates/gated/busabase.json": localizedManifest }), {
      repo: "busabase/templates",
      ref: "main",
    });
    expect(index.templates[0].description).toEqual({
      en: "The gated desk.",
      "zh-CN": "受限工作台。",
    });
  });

  it("writes per-locale media into templates.json, and omits the key when none is declared", () => {
    const locales = {
      "zh-CN": {
        screenshots: ["assets/screenshots/cover-zh-CN.webp"],
        video: "assets/recordings/gated-zh-CN.mp4",
      },
      ja: { video: "assets/recordings/gated-ja.mp4" },
    };
    const localizedMedia = JSON.stringify({
      format: PACKAGE_FORMAT,
      name: "gated",
      description: "The gated desk.",
      template: {
        category: "ops",
        screenshots: ["assets/screenshots/cover.webp"],
        video: "assets/recordings/gated.mp4",
        locales,
      },
    });
    const index = buildTemplateIndex(repo({ "templates/gated/busabase.json": localizedMedia }), {
      repo: "busabase/templates",
      ref: "main",
    });
    expect(index.templates[0].screenshots).toEqual(["assets/screenshots/cover.webp"]);
    expect(index.templates[0].video).toBe("assets/recordings/gated.mp4");
    expect(index.templates[0].locales).toEqual(locales);
    expect(JSON.parse(renderTemplateIndex(index)).templates[0].locales).toEqual(locales);

    const plain = buildTemplateIndex(repo(), { repo: "busabase/templates", ref: "main" });
    expect(Object.hasOwn(plain.templates[0], "locales")).toBe(false);
  });

  it("carries a locale-keyed manifest displayName onto the index entry, and omits it when absent", () => {
    const withDisplayName = JSON.stringify({
      format: PACKAGE_FORMAT,
      name: "gated",
      description: "The gated desk.",
      displayName: { en: "Gated Desk", "zh-CN": "受限工作台" },
      template: { category: "ops" },
    });
    const index = buildTemplateIndex(repo({ "templates/gated/busabase.json": withDisplayName }), {
      repo: "busabase/templates",
      ref: "main",
    });
    expect(index.templates[0].displayName).toEqual({ en: "Gated Desk", "zh-CN": "受限工作台" });

    const withoutDisplayName = buildTemplateIndex(repo(), {
      repo: "busabase/templates",
      ref: "main",
    });
    expect(withoutDisplayName.templates[0].displayName).toBeUndefined();
  });
});
