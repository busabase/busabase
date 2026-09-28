import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import { describe, expect, it } from "vitest";
import { filterTemplates } from "./template-search";

const template = (overrides: Partial<TemplateCardVO> = {}): TemplateCardVO => ({
  id: "owner/repo/crm",
  name: "crm-starter",
  description: "Track deals and contacts.",
  category: "Sales",
  tags: [],
  screenshots: [],
  agentPrompts: [],
  stats: { folders: 0, docs: 0, bases: 1, records: 3, files: 0, airapps: 0, skill: false },
  install: { repoUrl: "https://github.com/owner/repo", intoFolder: "crm-starter" },
  sourceUrl: "https://github.com/owner/repo",
  ...overrides,
});

describe("filterTemplates", () => {
  it("returns everything for an empty or blank query", () => {
    const all = [template(), template({ id: "b", name: "b" })];
    expect(filterTemplates(all, "")).toEqual(all);
    expect(filterTemplates(all, "   ")).toEqual(all);
  });

  it("matches the name case-insensitively", () => {
    expect(filterTemplates([template()], "CRM-STARTER")).toHaveLength(1);
    expect(filterTemplates([template()], "widgets")).toHaveLength(0);
  });

  it("matches the description, category and tags — not just the name", () => {
    const t = template({ tags: ["pipeline", "b2b"] });
    expect(filterTemplates([t], "deals")).toHaveLength(1); // description
    expect(filterTemplates([t], "sales")).toHaveLength(1); // category
    expect(filterTemplates([t], "b2b")).toHaveLength(1); // tags
  });

  it("resolves an iString displayName rather than matching it as a raw object", () => {
    // The bug this guards: `String({ en: "Rocket CRM" })` is
    // "[object Object]", which a search box can never type.
    const t = template({ displayName: { en: "Rocket CRM", "zh-CN": "火箭 CRM" } });
    expect(filterTemplates([t], "rocket")).toHaveLength(1);
    expect(filterTemplates([t], "object")).toHaveLength(0);
  });
});
