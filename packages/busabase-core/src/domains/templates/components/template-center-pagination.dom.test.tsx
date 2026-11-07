// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubmitPermissionProvider } from "../../dashboard/components/split-submit-button";
import { TEMPLATES_PAGE_SIZE } from "../utils/pagination";
import { TemplateCenter } from "./template-center";

// jsdom implements no layout, so elements have no `scrollTo`.
Element.prototype.scrollTo ??= () => {};

const makeTemplate = (index: number): TemplateCardVO => ({
  id: `busabase/templates/templates/t-${index}`,
  name: `t-${index}`,
  displayName: `Template ${index}`,
  description: index % 2 === 0 ? "Even workspace" : "Odd workspace",
  category: "Operations",
  tags: [],
  screenshots: [],
  agentPrompts: [],
  stats: { folders: 1, docs: 1, bases: 1, records: 1, files: 0, airapps: 0, skill: false },
  install: {
    repoUrl: `https://github.com/busabase/templates/tree/main/templates/t-${index}`,
    intoFolder: `t-${index}`,
  },
  sourceUrl: `https://github.com/busabase/templates/tree/main/templates/t-${index}`,
});

// 30 templates: a full first page of 24 and a second page of 6.
const templates = Array.from({ length: 30 }, (_, index) => makeTemplate(index + 1));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { templates }, isPending: false, isFetching: false, isError: false }),
}));

const orpc = {
  templates: { list: { queryOptions: () => ({}) } },
} as unknown as BusabaseQueryUtils;

/** The host's routing, reduced to the one piece of state it owns: which template is open. */
function Host() {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  return (
    <SubmitPermissionProvider permissionLevel="read">
      <TemplateCenter
        orpc={orpc}
        selectedName={selectedName}
        onSelect={(template) => setSelectedName(template.name)}
        onBack={() => setSelectedName(null)}
        onInstalled={() => {}}
        onReviewChangeRequests={() => {}}
      />
    </SubmitPermissionProvider>
  );
}

const cardTitles = () =>
  screen
    .queryAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent)
    .filter((text) => text?.startsWith("Template "));

const pager = () => screen.getByRole("navigation", { name: "Template pages" });

afterEach(cleanup);

describe("Template Center pagination", () => {
  it("shows one page of templates and moves between pages", () => {
    render(<Host />);
    expect(TEMPLATES_PAGE_SIZE).toBe(24);
    expect(cardTitles()).toHaveLength(24);
    expect(cardTitles()[0]).toBe("Template 1");

    fireEvent.click(within(pager()).getByRole("link", { name: "Go to page 2" }));
    expect(cardTitles()).toEqual([25, 26, 27, 28, 29, 30].map((n) => `Template ${n}`));
    expect(within(pager()).getByRole("link", { name: "Page 2, current page" })).toBeTruthy();

    fireEvent.click(within(pager()).getByRole("link", { name: "Go to previous page" }));
    expect(cardTitles()).toHaveLength(24);
  });

  it("starts a new search on its first page, and hides the pager when one page is enough", () => {
    render(<Host />);
    fireEvent.click(within(pager()).getByRole("link", { name: "Go to page 2" }));

    fireEvent.change(screen.getByPlaceholderText("Search templates…"), {
      target: { value: "even" },
    });
    // 15 even-numbered templates: one page, starting from the first match.
    expect(cardTitles()).toHaveLength(15);
    expect(cardTitles()[0]).toBe("Template 2");
    expect(screen.queryByRole("navigation", { name: "Template pages" })).toBeNull();
  });

  it("returns from a template's detail page to the page the user left", () => {
    render(<Host />);
    fireEvent.click(within(pager()).getByRole("link", { name: "Go to page 2" }));

    fireEvent.click(screen.getByRole("button", { name: /Template 27/ }));
    expect(cardTitles()).toEqual([]);

    // The detail page's back button is labelled with where it goes.
    fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    expect(cardTitles()[0]).toBe("Template 25");
  });
});
