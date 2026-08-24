import { describe, expect, it } from "vitest";
import { resolvePrimaryAirApp, SkillFrontmatterSchema, TemplateManifestSchema } from "./template";
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
