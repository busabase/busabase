import { describe, expect, it } from "vitest";
import { coreMessagesByLocale } from "../../i18n";
import { getBusabaseDashboardRoutes } from "./routes";

describe("dashboard SPA route titles", () => {
  it("resolves catalog names for agents, templates, and first-party node types", () => {
    const messages = coreMessagesByLocale["zh-CN"];
    const routes = getBusabaseDashboardRoutes(null, messages);
    const title = (path: string) => routes.find((route) => route.path === path)?.title;

    expect(title("/agents")).toBe(messages.nav.agents);
    expect(title("/agents/new")).toBe(messages.agents.addAgent);
    expect(title("/agents/:agentSlug")).toBe(messages.actor.agent);
    expect(title("/templates")).toBe(messages.nav.templates);
    expect(title("/templates/:templateName")).toBe(messages.routes.template);
    expect(title("/embed-links")).toBe(messages.routes.embedLinks);
    expect(title("/doc/:slug")).toBe(messages.nodeDetail.doc);
    expect(title("/workflow/:slug")).toBe(messages.nodeDetail.workflow);
  });

  it("retains the registry's English labels without a locale catalog", () => {
    const routes = getBusabaseDashboardRoutes(null);
    expect(routes.find((route) => route.path === "/agents")?.title).toBe("Agents");
    expect(routes.find((route) => route.path === "/embed-links")?.title).toBe("Embed links");
    expect(routes.find((route) => route.path === "/doc/:slug")?.title).toBe("Doc");
  });
});
