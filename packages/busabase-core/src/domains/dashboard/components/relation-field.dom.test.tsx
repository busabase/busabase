// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, RecordVO } from "busabase-contract/types";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelationFieldEditor } from "./relation-field";

afterEach(cleanup);
const primary = { id: "title", slug: "title", name: "Title", type: "text", position: 0 };
const base = { id: "target", fields: [primary] };
const field = {
  id: "relation",
  slug: "relation",
  type: "relation",
  options: { targetBaseId: "target" },
} as BaseFieldVO;
const makeRecord = (id: string, title: string) =>
  ({ id, base, headCommit: { payload: { title } } }) as unknown as RecordVO;
const math = makeRecord("math", "Mathematics");
const biology = makeRecord("biology", "Biology");

function mount(
  client: BusabaseDashboardApiClient,
  { multiple = true, initial = ["math"], loaded = [math] } = {},
) {
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <>
        <RelationFieldEditor
          client={client}
          field={{ ...field, options: { ...field.options, multiple } }}
          fieldName="Subjects"
          inputId="subjects"
          loadedRecords={loaded}
          value={value}
          onChange={(next) => setValue(Array.isArray(next) ? next : next ? [String(next)] : [])}
        />
        <output>{JSON.stringify(value)}</output>
      </>
    );
  }
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Harness />
    </QueryClientProvider>,
  );
}
const makeClient = (
  listRecordsPage = vi
    .fn()
    .mockResolvedValue({ records: [math, biology], total: 2, totalPages: 1, page: 1 }),
) =>
  ({
    getBase: vi.fn().mockResolvedValue(base),
    listRecordsPage,
    getRecord: vi.fn().mockResolvedValue(math),
    getRecords: vi.fn().mockResolvedValue({ records: [math], missingIds: [] }),
  }) as unknown as BusabaseDashboardApiClient;

describe("RelationFieldEditor", () => {
  it("appends selections, retains them through search and removes individual chips", async () => {
    const list = vi.fn().mockImplementation(async ({ filters }) => ({
      records: filters ? [biology] : [math, biology],
      total: 2,
      totalPages: 1,
      page: 1,
    }));
    mount(makeClient(list));
    fireEvent.click(screen.getByRole("button", { name: "Subjects" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Biology/ }));
    expect(screen.getByText('["math","biology"]')).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Bio" } });
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ filters: [expect.objectContaining({ value: "Bio" })] }),
      ),
    );
    expect(screen.getByRole("button", { name: "Remove link to Mathematics" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove link to Mathematics" }));
    expect(screen.getByText('["biology"]')).toBeTruthy();
  });

  it("pages past 50 without dropping existing links", async () => {
    const list = vi.fn().mockImplementation(async ({ page }) => ({
      records: page === 1 ? [math] : [biology],
      total: 51,
      totalPages: 2,
      page,
    }));
    mount(makeClient(list));
    fireEvent.click(screen.getByRole("button", { name: "Subjects" }));
    await screen.findByRole("checkbox", { name: /Mathematics/ });
    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Biology/ }));
    expect(screen.getByText('["math","biology"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove link to Mathematics" })).toBeTruthy();
  });

  it("single select replaces and closes, then allows clearing", async () => {
    mount(makeClient(), { multiple: false });
    fireEvent.click(screen.getByRole("button", { name: "Subjects" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Biology/ }));
    expect(screen.getByText('["biology"]')).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove link to Biology" }));
    expect(screen.getByText("[]")).toBeTruthy();
  });
  it("an unchanged initial search never resets a rapidly selected next page", async () => {
    const list = vi.fn().mockImplementation(async ({ page }) => ({
      records: page === 1 ? [math] : [biology],
      total: 51,
      totalPages: 2,
      page,
    }));
    mount(makeClient(list));
    fireEvent.click(screen.getByRole("button", { name: "Subjects" }));
    await screen.findByRole("checkbox", { name: /Mathematics/ });
    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));
    await screen.findByRole("checkbox", { name: /Biology/ });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(screen.getByText("2 / 2")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Biology/ })).toBeTruthy();
  });

  it("shows fetch errors and retries without losing existing values", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ records: [biology], total: 1, totalPages: 1, page: 1 });
    mount(makeClient(list));
    fireEvent.click(screen.getByRole("button", { name: "Subjects" }));
    await screen.findByRole("alert");
    expect(screen.getByText('["math"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("checkbox", { name: /Biology/ });
  });

  it("fetches a selected record outside the loaded page", async () => {
    const client = makeClient();
    mount(client, { loaded: [] });
    await screen.findByRole("button", { name: "Remove link to Mathematics" });
    // One batched read for the unseen selection, not one getRecord per id.
    expect(client.getRecords).toHaveBeenCalledWith(["math"]);
    expect(client.getRecord).not.toHaveBeenCalled();
  });

  it("keeps unseen links when selecting more, with a neutral unavailable label", async () => {
    const client = makeClient();
    vi.mocked(client.getRecords).mockResolvedValue({ records: [], missingIds: ["hidden"] });
    mount(client, { initial: ["hidden"], loaded: [] });
    await screen.findByRole("button", { name: "Remove link to Unavailable record" });
    fireEvent.click(screen.getByRole("button", { name: "Subjects" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Biology/ }));
    expect(screen.getByText('["hidden","biology"]')).toBeTruthy();
  });

  it("Escape closes the picker and restores trigger focus", async () => {
    mount(makeClient());
    fireEvent.click(screen.getByRole("button", { name: "Subjects" }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Subjects" }));
  });
});
