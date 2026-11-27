// @vitest-environment jsdom
import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AirAppSiteLogsVO,
  AirAppSiteReleasesVO,
} from "busabase-contract/domains/airapp/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, fmt } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { AirAppSiteReleaseSettings } from "./AirAppSiteReleases";

vi.mock("./AirAppPublishToSite", () => ({ AirAppPublishToSite: () => null }));
vi.mock("./AirAppSiteControls", () => ({ AirAppSiteSettings: () => null }));
vi.mock("../../dashboard/components/share-link-actions", () => ({ ShareLinkActions: () => null }));

const result = (version = "second", message = "Request completed"): AirAppSiteLogsVO => ({
  available: true,
  version,
  from: "2026-11-16T09:00:00.000Z",
  to: "2026-11-17T09:00:00.000Z",
  truncated: false,
  entries: [
    {
      id: `${version}-event`,
      timestamp: "2026-11-17T08:59:00.000Z",
      level: "info",
      message,
      method: "GET",
      path: "/orders",
      status: 200,
    },
  ],
});

const clients: QueryClient[] = [];
function setup(locale: keyof typeof coreMessagesByLocale = "en") {
  const read = vi.fn(
    async ({ version }: { nodeId: string; version: string }, _signal: AbortSignal) =>
      result(version),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(queryClient);
  const versions = ["second", "first"].map((version, index) => ({
    version,
    releaseNumber: 2 - index,
    createdAt: "2026-11-17T08:00:00.000Z",
    createdBy: "author",
    isCurrent: index === 0,
    canRollback: index !== 0,
  }));
  const orpc = {
    airapps: {
      siteState: {
        queryOptions: () => ({
          queryKey: ["site", "shop"],
          queryFn: async () => ({
            engine: "locked",
            publication: "live",
            isPublic: false,
            blockers: [],
          }),
        }),
      },
      siteReleases: {
        queryOptions: () => ({
          queryKey: ["releases", "shop"],
          queryFn: async () => ({
            available: true,
            status: "idle",
            lastError: null,
            versions,
            history: [],
          }),
        }),
      },
      siteRollback: { call: vi.fn() },
      siteLogs: {
        queryOptions: ({ input }: { input: { nodeId: string; version: string } }) => ({
          queryKey: ["logs", input.nodeId, input.version],
          queryFn: ({ signal }: { signal: AbortSignal }) => read(input, signal),
        }),
      },
    },
  } as unknown as BusabaseQueryUtils;
  const tree = (active = true) => (
    <CoreI18nProvider locale={locale}>
      <QueryClientProvider client={queryClient}>
        <AirAppSiteReleaseSettings active={active} nodeId="shop" nodeName="Shop" orpc={orpc} />
      </QueryClientProvider>
    </CoreI18nProvider>
  );
  const view = render(tree());
  return { read, queryClient, setActive: (active: boolean) => view.rerender(tree(active)) };
}

async function open(version = "v2") {
  fireEvent.click(await screen.findByRole("button", { name: `View logs for ${version}` }));
}

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.clearAllMocks();
});

describe("Site version logs", () => {
  it("expands logs inside the selected version before the next release and connects only its trigger", async () => {
    setup();
    await open();
    const secondTrigger = screen.getByRole("button", { name: "View logs for v2" });
    const firstTrigger = screen.getByRole("button", { name: "View logs for v1" });
    const secondRow = secondTrigger.closest("li");
    const firstRow = firstTrigger.closest("li");
    if (!secondRow || !firstRow) throw new Error("Release rows were not rendered");
    const secondLogs = await screen.findByRole("region", { name: "Logs · v2" });
    expect(secondLogs.parentElement).toBe(secondRow);
    expect(secondLogs.previousElementSibling?.contains(secondTrigger)).toBe(true);
    expect(secondLogs.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(secondTrigger.getAttribute("aria-controls")).toBe(secondLogs.id);
    expect(secondTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(firstTrigger.getAttribute("aria-controls")).toBeNull();
    expect(firstTrigger.getAttribute("aria-expanded")).toBe("false");
    await open("v1");
    const firstLogs = await screen.findByRole("region", { name: "Logs · v1" });
    expect(firstLogs.parentElement).toBe(firstRow);
    expect(firstLogs.previousElementSibling?.contains(firstTrigger)).toBe(true);
    expect(firstLogs.id).not.toBe(secondLogs.id);
    expect(firstTrigger.getAttribute("aria-controls")).toBe(firstLogs.id);
    expect(secondTrigger.getAttribute("aria-controls")).toBeNull();
    expect(screen.queryByRole("region", { name: "Logs · v2" })).toBeNull();
    expect(document.querySelectorAll("[data-airapp-site-logs]")).toHaveLength(1);
    fireEvent.click(within(firstLogs).getByRole("button", { name: "Close logs" }));
    expect(document.activeElement).toBe(firstTrigger);
    expect(firstTrigger.getAttribute("aria-controls")).toBeNull();
  });

  it("keeps the selected version's panel and request when release rows reorder", async () => {
    const { queryClient, read } = setup();
    await open();
    const logs = await screen.findByRole("region", { name: "Logs · v2" });
    await within(logs).findByText("Request completed");
    const trigger = screen.getByRole("button", { name: "View logs for v2" });
    const selectedRow = trigger.closest("li");
    const otherRow = screen.getByRole("button", { name: "View logs for v1" }).closest("li");
    const releases = queryClient.getQueryData<AirAppSiteReleasesVO>(["releases", "shop"]);
    if (!releases) throw new Error("Release query has no data");
    await act(async () => {
      queryClient.setQueryData<AirAppSiteReleasesVO>(["releases", "shop"], {
        ...releases,
        versions: releases.versions.map((version) => ({
          ...version,
          isCurrent: version.version === "first",
          canRollback: version.version !== "first",
        })),
      });
    });
    await waitFor(() => expect(otherRow?.nextElementSibling).toBe(selectedRow));
    expect(screen.getByRole("region", { name: "Logs · v2" })).toBe(logs);
    expect(logs.parentElement).toBe(selectedRow);
    expect(trigger.getAttribute("aria-controls")).toBe(logs.id);
    expect(read).toHaveBeenCalledTimes(1);
    fireEvent.click(within(logs).getByRole("button", { name: "Close logs" }));
    expect(document.activeElement).toBe(trigger);
  });

  it("loads only after selecting a version, keeps lapsed-plan logs readable and restores trigger focus on close", async () => {
    const { read } = setup();
    await screen.findByRole("button", { name: "View logs for v2" });
    expect(read).not.toHaveBeenCalled();
    await open();
    const region = await screen.findByRole("region", { name: "Logs · v2" });
    expect(document.activeElement).toBe(region);
    expect(await within(region).findByText("Request completed")).toBeTruthy();
    expect(read).toHaveBeenCalledExactlyOnceWith(
      { nodeId: "shop", version: "second" },
      expect.any(AbortSignal),
    );
    expect(within(region).getByText("GET /orders 200")).toBeTruthy();
    expect(within(region).getByText(/Requests crossing a release change may overlap/)).toBeTruthy();
    expect(within(region).getByText(/Earlier versions may have none/)).toBeTruthy();
    fireEvent.click(within(region).getByRole("button", { name: "Close logs" }));
    expect(screen.queryByRole("region", { name: "Logs · v2" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "View logs for v2" }));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("aborts an old version request and never shows its late result under another version", async () => {
    const { read } = setup();
    let resolve!: (data: AirAppSiteLogsVO) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await open();
    await screen.findByText("Loading production logs…");
    const signal = read.mock.calls[0][1];
    await open("v1");
    await screen.findByRole("region", { name: "Logs · v1" });
    await screen.findByText("Request completed");
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(result("second", "Late other version output")));
    expect(screen.queryByText("Late other version output")).toBeNull();
    expect(read.mock.calls.map(([input]) => input.version)).toEqual(["second", "first"]);
  });

  it("aborts when hidden and refetches when visible, without background polling", async () => {
    const { read, setActive } = setup();
    read.mockImplementationOnce(
      (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        }),
    );
    await open();
    await screen.findByText("Loading production logs…");
    const signal = read.mock.calls[0][1];
    setActive(false);
    await waitFor(() => expect(signal.aborted).toBe(true));
    expect(screen.queryByRole("region", { name: "Logs · v2" })).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    setActive(true);
    await screen.findByText("Request completed");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("aborts on close and refreshes on reopening instead of keeping an obsolete result", async () => {
    const { read } = setup();
    read.mockImplementationOnce(
      (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        }),
    );
    await open();
    await screen.findByText("Loading production logs…");
    const signal = read.mock.calls[0][1];
    fireEvent.click(screen.getByRole("button", { name: "Close logs" }));
    expect(signal.aborted).toBe(true);
    await open();
    await screen.findByText("Request completed");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("retries errors with localized safe copy and refreshes logs manually", async () => {
    const { read } = setup();
    read.mockRejectedValueOnce(new Error("raw provider query and secret should stay hidden"));
    await open();
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Could not load logs. Try again.",
    );
    expect(screen.queryByText(/raw provider/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Request completed");
    read.mockResolvedValueOnce(result("second", "New request completed"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh logs" }));
    await screen.findByText("New request completed");
    expect(screen.queryByText("Request completed")).toBeNull();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it.each([
    {
      data: { ...result(), available: false, entries: [] },
      text: "Production logs are not available on this deployment.",
    },
    {
      data: { ...result(), entries: [] },
      text: "No logs found for this version’s deployment periods in the last 24 hours.",
    },
  ])("distinguishes empty logs from an unsupported host: $text", async ({ data, text }) => {
    const { read } = setup();
    read.mockResolvedValueOnce(data);
    await open();
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Logs · v2" })).toBeNull();
  });

  it("renders Worker content as wrapping text and explains truncated results", async () => {
    const { read } = setup();
    const text = `<img src=x onerror="alert(1)">\n${"long-output".repeat(100)}`;
    read.mockResolvedValueOnce({ ...result("second", text), truncated: true });
    await open();
    const list = await screen.findByRole("list", { name: "Logs · v2" });
    expect(list.textContent).toContain(text);
    expect(list.querySelector("img")).toBeNull();
    expect(list.querySelector("p.whitespace-pre-wrap")).toBeTruthy();
    expect(list.parentElement?.className).toContain("overflow-y-auto");
    expect(screen.getByText(/More events or deployment periods may be omitted/)).toBeTruthy();
  });

  it("has translated labels and period/collection limits in every supported catalog", () => {
    for (const [locale, messages] of Object.entries(coreMessagesByLocale)) {
      const copy = messages.airapp.site.logs;
      expect(copy.button, locale).toBeTruthy();
      expect(copy.description, locale).toBeTruthy();
      expect(copy.collectionHint, locale).toBeTruthy();
      expect(copy.contentHiddenTitle, locale).toBeTruthy();
      expect(copy.contentHiddenDescription, locale).toBeTruthy();
      if (locale !== "en") {
        expect(copy.contentHiddenTitle, locale).not.toBe(
          coreMessagesByLocale.en.airapp.site.logs.contentHiddenTitle,
        );
        expect(copy.contentHiddenDescription, locale).not.toBe(
          coreMessagesByLocale.en.airapp.site.logs.contentHiddenDescription,
        );
      }
      expect(fmt(copy.versionButton, { version: "v3" }), locale).toContain("v3");
      expect(fmt(copy.title, { version: "v3" }), locale).toContain("v3");
      for (const value of Object.values(copy.levels)) expect(value, locale).toBeTruthy();
    }
  });

  it("shows available request metadata with a content-hidden notice, without a load error or retry", async () => {
    const { read } = setup();
    read.mockResolvedValueOnce({
      ...result(),
      contentHiddenReason: "VAULT_REDACTION_CONTEXT_UNAVAILABLE",
      entries: result().entries.map((entry) => ({
        ...entry,
        message: "hidden-log-body-sentinel",
        path: "/hidden-request-path-sentinel",
      })),
    });
    await open();
    const copy = coreMessagesByLocale.en.airapp.site.logs;
    const notice = await screen.findByText(copy.contentHiddenTitle);
    expect(notice.closest("[data-airapp-site-logs-content-hidden]")?.getAttribute("role")).toBe(
      "status",
    );
    expect(screen.getByText(copy.contentHiddenDescription)).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Logs · v2" });
    expect(list.textContent).toContain("GET 200");
    expect(within(list).getByText("Info")).toBeTruthy();
    expect(list.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-17T08:59:00.000Z");
    expect(list.textContent).not.toContain("hidden-log-body-sentinel");
    expect(list.textContent).not.toContain("hidden-request-path-sentinel");
    expect(screen.queryByText(copy.loadFailed)).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: copy.refresh }).disabled).toBe(
      false,
    );
    // A fresh authorized redaction context can restore ordinary content on demand.
    fireEvent.click(screen.getByRole("button", { name: copy.refresh }));
    await screen.findByText("Request completed");
    expect(screen.queryByText(copy.contentHiddenTitle)).toBeNull();
    expect(screen.getByText("GET /orders 200")).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps permission refusal distinct from available hidden content and transient provider failures", async () => {
    const { read } = setup();
    read.mockRejectedValue(new ORPCError("FORBIDDEN", { message: "private-query-details" }));
    await open();
    const messages = coreMessagesByLocale.en;
    await screen.findByText(messages.airapp.site.environment.forbidden);
    expect(screen.queryByText(messages.airapp.site.logs.loadFailed)).toBeNull();
    expect(screen.queryByText(messages.airapp.site.logs.contentHiddenTitle)).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: messages.airapp.site.logs.refresh })).toBeNull();
    expect(screen.getByRole("button", { name: messages.airapp.site.logs.close })).toBeTruthy();
    expect(document.body.textContent).not.toContain("private-query-details");
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("keeps confirmed current log content useful beside metadata-only events", async () => {
    const { read } = setup();
    const safe = result("second", "Current request [redacted]").entries[0];
    read.mockResolvedValueOnce({
      ...result(),
      contentHiddenReason: "VAULT_REDACTION_CONTEXT_UNAVAILABLE",
      entries: [
        safe,
        {
          ...safe,
          id: "unconfirmable-event",
          contentHiddenReason: "VAULT_REDACTION_CONTEXT_UNAVAILABLE",
          message: "old-unknown-secret-sentinel",
          path: "/old-unknown-secret-sentinel",
        },
      ],
    });
    await open();
    await screen.findByText(coreMessagesByLocale.en.airapp.site.logs.contentHiddenDescription);
    expect(await screen.findByText("Current request [redacted]")).toBeTruthy();
    expect(screen.getByText("GET /orders 200")).toBeTruthy();
    expect(screen.getByText("GET 200")).toBeTruthy();
    expect(document.body.textContent).not.toContain("old-unknown-secret-sentinel");
    expect(screen.getAllByText("Info")).toHaveLength(2);
  });
});
