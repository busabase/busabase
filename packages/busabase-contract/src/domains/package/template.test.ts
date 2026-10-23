import { describe, expect, it } from "vitest";
import {
  resolvePrimaryAirApp,
  SkillFrontmatterSchema,
  TEMPLATE_VIDEO_LIMIT,
  TemplateManifestSchema,
} from "./template";
import { PACKAGE_FORMAT, PackageManifestSchema } from "./types";

const manifest = (extra: Record<string, unknown> = {}) => ({
  format: PACKAGE_FORMAT,
  name: "kelly-email",
  description: "Inbox triage desk",
  ...extra,
});

describe("PackageManifestSchema — template is additive", () => {
  it("still parses a manifest with no template object", () => {
    const parsed = PackageManifestSchema.parse(manifest());
    expect(parsed.template).toBeUndefined();
  });

  it("parses a template manifest and defaults its optional arrays", () => {
    const parsed = PackageManifestSchema.parse(
      manifest({ template: { category: "email", airapp: "kelly-email-app" } }),
    );
    expect(parsed.template?.category).toBe("email");
    expect(parsed.template?.agentPrompts).toEqual([]);
    expect(parsed.template?.secrets).toEqual([]);
  });

  it("rejects a template object with no category", () => {
    expect(() => PackageManifestSchema.parse(manifest({ template: {} }))).toThrow();
  });
});

describe("TemplateManifestSchema", () => {
  it("keeps declared agent prompts and secrets", () => {
    const parsed = TemplateManifestSchema.parse({
      category: "email",
      agentPrompts: ["triage today's mail"],
      secrets: [{ key: "IMAP_PASSWORD", description: "mailbox password" }],
    });
    expect(parsed.agentPrompts).toEqual(["triage today's mail"]);
    expect(parsed.secrets[0]).toEqual({
      key: "IMAP_PASSWORD",
      description: "mailbox password",
      required: true,
    });
  });
});

describe("TemplateManifestSchema — videos", () => {
  it("keeps a clip list as objects, next to the untouched single video", () => {
    const parsed = TemplateManifestSchema.parse({
      category: "ops",
      video: "assets/recordings/tour.mp4",
      videos: [
        { src: "assets/recordings/tour.mp4", title: "30-second tour" },
        { src: "assets/recordings/full.mp4" },
      ],
    });
    expect(parsed.video).toBe("assets/recordings/tour.mp4");
    expect(parsed.videos).toEqual([
      { src: "assets/recordings/tour.mp4", title: "30-second tour" },
      { src: "assets/recordings/full.mp4" },
    ]);
  });

  it("leaves videos undefined for a manifest that only ever had `video`", () => {
    const parsed = TemplateManifestSchema.parse({
      category: "ops",
      video: "assets/recordings/a.mp4",
    });
    expect(parsed.videos).toBeUndefined();
  });

  it("keeps a locale's own clip list", () => {
    const parsed = TemplateManifestSchema.parse({
      category: "ops",
      locales: {
        "zh-CN": { videos: [{ src: "assets/recordings/tour-zh-CN.mp4", title: "30 秒看懂" }] },
      },
    });
    expect(parsed.locales?.["zh-CN"]?.videos).toEqual([
      { src: "assets/recordings/tour-zh-CN.mp4", title: "30 秒看懂" },
    ]);
  });

  it("does not reject a list over the limit: the catalog must still parse, `check` reports it", () => {
    const clips = Array.from({ length: TEMPLATE_VIDEO_LIMIT + 1 }, (_, i) => ({
      src: `v${i}.mp4`,
    }));
    expect(TemplateManifestSchema.parse({ category: "ops", videos: clips }).videos).toHaveLength(
      TEMPLATE_VIDEO_LIMIT + 1,
    );
  });

  it("rejects a bare path in the list: clips are objects from the first release", () => {
    expect(() =>
      TemplateManifestSchema.parse({ category: "ops", videos: ["assets/recordings/a.mp4"] }),
    ).toThrow();
  });
});

describe("TemplateManifestSchema — locales", () => {
  it("leaves locales undefined when the manifest declares none", () => {
    const parsed = TemplateManifestSchema.parse({
      category: "ops",
      screenshots: ["assets/screenshots/cover.webp"],
      video: "assets/recordings/desk.mp4",
    });
    expect(parsed.locales).toBeUndefined();
    expect(parsed.screenshots).toEqual(["assets/screenshots/cover.webp"]);
    expect(parsed.video).toBe("assets/recordings/desk.mp4");
  });

  it("keeps per-locale screenshots and video next to the untouched defaults", () => {
    const parsed = TemplateManifestSchema.parse({
      category: "ops",
      screenshots: ["assets/screenshots/cover.webp"],
      video: "assets/recordings/desk.mp4",
      locales: {
        "zh-CN": {
          screenshots: ["assets/screenshots/cover-zh-CN.webp"],
          video: "assets/recordings/desk-zh-CN.mp4",
        },
        ja: { video: "assets/recordings/desk-ja.mp4" },
      },
    });
    expect(parsed.screenshots).toEqual(["assets/screenshots/cover.webp"]);
    expect(parsed.locales?.["zh-CN"]?.screenshots).toEqual(["assets/screenshots/cover-zh-CN.webp"]);
    expect(parsed.locales?.ja).toEqual({ video: "assets/recordings/desk-ja.mp4" });
  });

  it("accepts a locale key the server does not know rather than failing the install", () => {
    const parsed = TemplateManifestSchema.parse({
      category: "ops",
      locales: { "tlh-KL": { screenshots: ["assets/screenshots/cover-tlh-KL.webp"] } },
    });
    expect(Object.keys(parsed.locales ?? {})).toEqual(["tlh-KL"]);
  });
});

describe("SkillFrontmatterSchema", () => {
  it("treats a skill with no busabase metadata as not-a-template", () => {
    const parsed = SkillFrontmatterSchema.parse({ name: "busabase", description: "drive it" });
    expect(parsed.metadata?.busabase).toBeUndefined();
  });

  it("requires template:true to be explicit, defaulting to false", () => {
    const parsed = SkillFrontmatterSchema.parse({
      name: "kelly-email",
      metadata: { busabase: { resources: ["reviews"] } },
    });
    expect(parsed.metadata?.busabase?.template).toBe(false);
    expect(parsed.metadata?.busabase?.resources).toEqual(["reviews"]);
  });
});

describe("resolvePrimaryAirApp", () => {
  it("accepts a lone AirApp with nothing declared", () => {
    expect(resolvePrimaryAirApp(undefined, ["app"])).toEqual({ slug: "app" });
  });

  it("refuses to guess between several undeclared AirApps", () => {
    const result = resolvePrimaryAirApp(undefined, ["admin", "public"]);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("declare which one is primary");
  });

  it("honours the single-app shorthand", () => {
    const template = TemplateManifestSchema.parse({ category: "email", airapp: "admin" });
    expect(resolvePrimaryAirApp(template, ["admin", "public"])).toEqual({ slug: "admin" });
  });

  it("rejects a shorthand pointing at an AirApp that is not in content/", () => {
    const template = TemplateManifestSchema.parse({ category: "email", airapp: "ghost" });
    expect(resolvePrimaryAirApp(template, ["admin"])).toHaveProperty("error");
  });

  it("picks the entry marked primary in the multi-app form", () => {
    const template = TemplateManifestSchema.parse({
      category: "email",
      airapps: [
        { slug: "admin", role: "admin" },
        { slug: "desk", role: "primary" },
      ],
    });
    expect(resolvePrimaryAirApp(template, ["admin", "desk"])).toEqual({ slug: "desk" });
  });

  it("requires exactly one primary", () => {
    const template = TemplateManifestSchema.parse({
      category: "email",
      airapps: [
        { slug: "admin", role: "primary" },
        { slug: "desk", role: "primary" },
      ],
    });
    expect(resolvePrimaryAirApp(template, ["admin", "desk"])).toHaveProperty("error");
  });

  it("rejects declaring both forms at once", () => {
    const template = TemplateManifestSchema.parse({
      category: "email",
      airapp: "desk",
      airapps: [{ slug: "desk", role: "primary" }],
    });
    expect(resolvePrimaryAirApp(template, ["desk"])).toHaveProperty("error");
  });

  it("reports no AirApp for a data-only template", () => {
    expect(resolvePrimaryAirApp(undefined, [])).toEqual({
      error: "This package contains no AirApp.",
    });
  });
});
