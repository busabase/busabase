// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  PlaybookListItemVO,
  PlaybookListResultVO,
  PlaybookSearchResultVO,
} from "busabase-contract/contract/playbook-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { PlaybooksView } from "./playbooks-view";

// The real dialog loads prompts over oRPC; this test only cares that the page
// mounts it for the right node.
vi.mock("./node-agent-prompts-dialog", () => ({
  NodeAgentPromptsDialog: (props: { nodeId: string; nodeName: string; open: boolean }) =>
    props.open ? (
      <div data-testid="prompts-dialog">
        {props.nodeId}:{props.nodeName}
      </div>
    ) : null,
}));

const base = { updatedAt: "2026-09-20T00:00:00.000Z" };

const rootSkill: PlaybookListItemVO = {
  ...base,
  kind: "skill",
  nodeId: "nod_root_skill",
  nodeType: "skill",
  nodeName: "Onboarding",
  nodeSlug: "onboarding",
  path: [],
  name: "Onboarding",
  description: "Welcome a new customer",
};
const salesSkill: PlaybookListItemVO = {
  ...base,
  kind: "skill",
  nodeId: "nod_weekly",
  nodeType: "skill",
  nodeName: "Weekly Report",
  nodeSlug: "weekly-report",
  path: ["Sales"],
  name: "Weekly Report",
  description: "Compile the weekly sales report",
};
const visitPrompt: PlaybookListItemVO = {
  ...base,
  kind: "prompt",
  nodeId: "nod_visits",
  nodeType: "base",
  nodeName: "Visits",
  nodeSlug: "visits",
  path: ["Sales"],
  key: "log-visit",
  label: "Log a customer visit",
  intent: "change",
  bodyPreview: "Add one record to {target} for today's visit.",
};

function stubOrpc({
  list,
  search = vi.fn(async (): Promise<PlaybookSearchResultVO> => emptySearch),
}: {
  list: () => Promise<PlaybookListResultVO>;
  search?: (input: { queries: string[]; locale?: string }) => Promise<PlaybookSearchResultVO>;
}) {
  const listFn = vi.fn(list);
  const orpc = {
    playbooks: {
      key: () => ["playbooks"],
      list: {
        queryOptions: ({ input }: { input: unknown }) => ({
          queryKey: ["playbooks", "list", input],
          queryFn: () => listFn(),
        }),
      },
      search: {
        queryOptions: ({ input }: { input: { queries: string[]; locale?: string } }) => ({
          queryKey: ["playbooks", "search", input],
          queryFn: () => search(input),
        }),
      },
    },
  } as unknown as BusabaseQueryUtils;
  return { orpc, listFn, search };
}

const emptySearch: PlaybookSearchResultVO = {
  items: [],
  total: 0,
  truncated: false,
  coverage: { skillsScanned: 0, promptNodesScanned: 0 },
};

function renderView(orpc: BusabaseQueryUtils) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CoreI18nProvider locale="en">
        <PlaybooksView orpc={orpc} />
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PlaybooksView", () => {
  it("groups the catalog by folder, filters by kind, and links each playbook to its node", async () => {
    const { orpc } = stubOrpc({
      list: async () => ({
        items: [rootSkill, salesSkill, visitPrompt],
        total: 3,
        truncated: false,
      }),
    });
    renderView(orpc);

    const catalog = await screen.findByTestId("playbooks-catalog");
    const workspace = within(catalog).getByRole("region", { name: "Workspace" });
    const sales = within(catalog).getByRole("region", { name: "Sales" });
    expect(within(workspace).getByText("Onboarding")).toBeTruthy();
    expect(within(sales).getByText("Weekly Report")).toBeTruthy();
    expect(within(sales).getByText("Log a customer visit")).toBeTruthy();
    // Prompt rows name their node, their intent, and a body preview.
    expect(within(sales).getByText("on Visits")).toBeTruthy();
    expect(within(sales).getByText("Makes changes")).toBeTruthy();
    expect(within(sales).getByText("Add one record to {target} for today's visit.")).toBeTruthy();
    expect(
      within(sales).getByRole("link", { name: "Log a customer visit" }).getAttribute("href"),
    ).toBe("/base/visits");
    expect(within(sales).getByRole("link", { name: "Weekly Report" }).getAttribute("href")).toBe(
      "/skill/weekly-report",
    );
    expect(screen.getByText("3 playbooks")).toBeTruthy();

    // Kind filter: Prompts hides skills and the now-empty Workspace group.
    fireEvent.click(screen.getByRole("button", { name: /^Prompts/ }));
    expect(within(catalog).queryByText("Weekly Report")).toBeNull();
    expect(within(catalog).queryByRole("region", { name: "Workspace" })).toBeNull();
    expect(within(catalog).getByText("Log a customer visit")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Skills/ }));
    expect(within(catalog).queryByText("Log a customer visit")).toBeNull();
    expect(within(catalog).getByText("Onboarding")).toBeTruthy();

    // "Open prompts" mounts the prompts dialog for that prompt's node.
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open prompts" }));
    expect(screen.getByTestId("prompts-dialog").textContent).toBe("nod_visits:Visits");
  });

  it("runs the real search with the typed sentence and shows ranked results with why they matched", async () => {
    const search = vi.fn(
      async (_input: { queries: string[]; locale?: string }): Promise<PlaybookSearchResultVO> => ({
        items: [
          {
            ...visitPrompt,
            matchedOn: ["label", "body"],
            score: 8,
          },
        ],
        total: 4,
        truncated: true,
        coverage: { skillsScanned: 2, promptNodesScanned: 1 },
      }),
    );
    const { orpc } = stubOrpc({
      list: async () => ({ items: [visitPrompt], total: 1, truncated: false }),
      search,
    });
    renderView(orpc);

    fireEvent.change(screen.getByLabelText("What would you tell an agent?"), {
      target: { value: "log customer visit" },
    });
    // Nothing is sent while typing — only on submit.
    expect(search).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Find" }));

    const results = await screen.findByTestId("playbooks-try-results");
    expect(search).toHaveBeenCalledWith({ queries: ["log customer visit"], locale: "en" });
    expect(within(results).getByText("Log a customer visit")).toBeTruthy();
    expect(within(results).getByText("Sales")).toBeTruthy();
    expect(within(results).getByText("label")).toBeTruthy();
    expect(within(results).getByText("body")).toBeTruthy();
    expect(screen.getByText("Showing 1 of 4 matching playbooks")).toBeTruthy();
    expect(screen.getByText(/literal preview/)).toBeTruthy();
  });

  it("suggests wording the label the way people talk when the sentence finds nothing", async () => {
    const { orpc } = stubOrpc({
      list: async () => ({ items: [visitPrompt], total: 1, truncated: false }),
    });
    renderView(orpc);

    fireEvent.change(screen.getByLabelText("What would you tell an agent?"), {
      target: { value: "记一下拜访" },
    });
    // Enter submits too, not just the button.
    const form = screen.getByLabelText("What would you tell an agent?").closest("form");
    if (!form) throw new Error("try-it input is not inside a form");
    fireEvent.submit(form);

    const empty = await screen.findByTestId("playbooks-try-empty");
    expect(within(empty).getByText("No playbook matches that sentence")).toBeTruthy();
    expect(within(empty).getByText(/the way people actually ask/)).toBeTruthy();
  });

  it("shows how often agents used each playbook, and flags the unused ones", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 - 60_000).toISOString();
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const { orpc } = stubOrpc({
      list: async () => ({
        items: [
          { ...rootSkill, usage: { changeRequests30d: 3, lastUsedAt: twoDaysAgo } },
          { ...salesSkill, usage: { changeRequests30d: 0, lastUsedAt: fortyDaysAgo } },
          { ...visitPrompt, usage: { changeRequests30d: 0, lastUsedAt: null } },
        ],
        total: 3,
        truncated: false,
      }),
    });
    renderView(orpc);

    const catalog = await screen.findByTestId("playbooks-catalog");
    const workspace = within(catalog).getByRole("region", { name: "Workspace" });
    const used = within(workspace).getByTestId("playbook-usage");
    expect(used.textContent).toBe("Used 3× in 30 days · last used 2 days ago");
    // The tooltip says what is counted: every status, only what the viewer can see, and
    // only uses that wrote something (a read-only follow records nothing).
    expect(used.getAttribute("title")).toMatch(
      /recorded this playbook, in any status.*Only ones you can see.*without writing anything isn't counted/,
    );

    const sales = within(catalog).getByRole("region", { name: "Sales" });
    const unused = within(sales).getAllByTestId("playbook-usage-unused");
    expect(unused).toHaveLength(2);
    for (const badge of unused) {
      expect(within(badge).getByText("Not used in 30 days")).toBeTruthy();
      expect(within(badge).getByText(/check its wording in Try it/)).toBeTruthy();
    }
    // Used before the window: still says when.
    expect(unused[0]?.textContent).toContain("last used last month");
    // Never used: no "last" at all.
    expect(unused[1]?.textContent).not.toContain("last");
    expect(
      within(unused[1] as HTMLElement)
        .getByText("Not used in 30 days")
        .getAttribute("title"),
    ).toMatch(/No change request recorded this playbook in 30 days\. Uses that wrote nothing/);
  });

  it("renders no usage line when the server sends no usage (older server)", async () => {
    const { orpc } = stubOrpc({
      list: async () => ({ items: [rootSkill], total: 1, truncated: false }),
    });
    renderView(orpc);
    await screen.findByTestId("playbooks-catalog");
    expect(screen.queryByTestId("playbook-usage")).toBeNull();
    expect(screen.queryByTestId("playbook-usage-unused")).toBeNull();
  });

  it("explains what a playbook is and how to make one when the space has none", async () => {
    const { orpc } = stubOrpc({ list: async () => ({ items: [], total: 0, truncated: false }) });
    renderView(orpc);

    const empty = await screen.findByTestId("playbooks-empty");
    expect(within(empty).getByText("No playbooks yet")).toBeTruthy();
    expect(within(empty).getByText(/Add a Skill node/)).toBeTruthy();
    expect(within(empty).getByText(/Agent prompts button/)).toBeTruthy();
    // No filter to offer over an empty catalog.
    expect(screen.queryByRole("button", { name: /^Prompts/ })).toBeNull();
    // The help text points at the real doc, not a dead reference.
    const guideLink = within(empty).getByRole("link", { name: /Open the full guide/ });
    expect(guideLink.getAttribute("href")).toBe("https://busabase.com/docs/agent-playbooks");
    expect(guideLink.getAttribute("target")).toBe("_blank");
  });

  it("links the empty-state guide to the localized doc page for locales that have one", async () => {
    const { orpc } = stubOrpc({ list: async () => ({ items: [], total: 0, truncated: false }) });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CoreI18nProvider locale="zh-CN">
          <PlaybooksView orpc={orpc} />
        </CoreI18nProvider>
      </QueryClientProvider>,
    );

    const empty = await screen.findByTestId("playbooks-empty");
    const guideLink = within(empty).getByRole("link", { name: /打开完整指南/ });
    expect(guideLink.getAttribute("href")).toBe("https://busabase.com/zh-CN/docs/agent-playbooks");
  });

  it("offers a retry when the catalog fails to load", async () => {
    let calls = 0;
    const { orpc, listFn } = stubOrpc({
      list: async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return { items: [salesSkill], total: 1, truncated: false };
      },
    });
    renderView(orpc);

    expect(await screen.findByText("Couldn't load playbooks")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Weekly Report")).toBeTruthy());
    expect(listFn).toHaveBeenCalledTimes(2);
  });
});
