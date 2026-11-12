// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, RecordVO } from "busabase-contract/types";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelationFieldEditor } from "./relation-field";

afterEach(cleanup);
const primary = { id: "title", slug: "title", name: "Title", type: "text", position: 0 };
const base = { id: "target", name: "Target table", fields: [primary] };
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
  it("bounds hydration and rendering for thousands of selected and nested links without truncating the saved value", async () => {
    const initial = Array.from({ length: 5000 }, (_, index) => `selected-${index}`);
    const nested = Array.from({ length: 1000 }, (_, index) => `nested-${index}`);
    const nestedField = { ...field, slug: "nested", position: 1, name: "Nested links" };
    const richBase = { ...base, fields: [primary, nestedField] } as unknown as RecordVO["base"];
    const candidate = {
      ...biology,
      base: richBase,
      headCommit: { ...biology.headCommit, payload: { title: "Biology", nested } },
    } as RecordVO;
    const client = makeClient(vi.fn().mockResolvedValue({ records: [candidate], totalPages: 1 }));
    vi.mocked(client.getBase).mockResolvedValue(richBase);
    vi.mocked(client.getRecords).mockImplementation(async (ids) => ({
      records: ids.map((id) => makeRecord(id, `Name ${id}`)),
      missingIds: [],
    }));
    mount(client, { initial, loaded: [] });
    await screen.findByRole("button", { name: "Remove link to Name selected-0" });
    expect(client.getRecords).toHaveBeenCalledWith(initial.slice(0, 20).sort());
    expect(screen.getAllByRole("button", { name: /Remove link to/ })).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Subjects" }));
    await screen.findByText("Name nested-0");
    expect(client.getRecords).toHaveBeenCalledWith(nested.slice(0, 3));
    expect(client.getRecords).toHaveBeenCalledTimes(2);
    expect(screen.getByText("+997")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show more (+4980)" }));
    await screen.findByRole("button", { name: "Remove link to Name selected-20" });
    expect(screen.getAllByRole("button", { name: /Remove link to/ })).toHaveLength(40);
    fireEvent.click(screen.getByRole("checkbox", { name: "Biology" }));
    expect(JSON.parse(screen.getByRole("status").textContent ?? "null")).toEqual([
      ...initial,
      biology.id,
    ]);
  });

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
    fireEvent.click(await screen.findByRole("checkbox", { name: /Biology/ }));
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
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Subjects" })),
    );
  });

  it("shows the first five fields with batched relation and lookup names, never raw ids", async () => {
    const relation = { ...field, slug: "teacher", name: "Teacher", position: 1 };
    const lookup = {
      ...field,
      id: "lookup",
      slug: "office",
      name: "Office",
      type: "lookup",
      position: 2,
      options: { lookup: { relationFieldSlug: "teacher", targetFieldSlug: "office" } },
    } as BaseFieldVO;
    const lookupName = {
      ...lookup,
      id: "lookup-name",
      slug: "teacher_name",
      name: "Teacher name",
      position: 3,
    };
    const richBase = {
      ...base,
      fields: [
        primary,
        relation,
        lookup,
        lookupName,
        {
          ...primary,
          id: "credits",
          slug: "credits",
          name: "Credits",
          type: "number",
          position: 4,
          options: {},
        },
        { ...primary, id: "extra", slug: "extra", name: "Hidden sixth field", position: 5 },
      ],
    };
    const candidate = {
      ...math,
      base: richBase,
      headCommit: {
        payload: {
          title: "Mathematics",
          teacher: ["rec-teacher", "rec-hidden"],
          office: ["raw-lookup-id"],
          credits: 3,
        },
      },
      computedFields: {
        office: { status: "ready", value: ["rec-office"], sources: [], targetField: relation },
        teacher_name: {
          status: "ready",
          value: ["Professor Wang"],
          sources: [],
          targetField: { ...primary, options: {} },
        },
      },
    } as unknown as RecordVO;
    const client = makeClient(vi.fn().mockResolvedValue({ records: [candidate], totalPages: 1 }));
    vi.mocked(client.getBase).mockResolvedValue(richBase as unknown as RecordVO["base"]);
    vi.mocked(client.getRecords).mockResolvedValue({
      records: [
        makeRecord("rec-teacher", "Professor Wang"),
        makeRecord("rec-office", "Science building"),
      ],
      missingIds: ["rec-hidden"],
    });
    mount(client, { initial: [], loaded: [] });
    fireEvent.click(screen.getByRole("button", { name: "Subjects" }));
    const card = (await screen.findByRole("checkbox", { name: "Mathematics" })).closest("label");
    if (!card) throw new Error("Missing candidate card");
    expect(screen.getByRole("heading", { name: 'Link records from "Target table"' })).toBeTruthy();
    await within(card).findByText("Science building");
    expect(within(card).getAllByText("Professor Wang")).toHaveLength(2);
    expect(within(card).getByText("Unavailable record")).toBeTruthy();
    expect(within(card).getByText("3")).toBeTruthy();
    expect(card.textContent).not.toMatch(/rec-|raw-lookup-id|Hidden sixth field/);
    expect(client.getRecords).toHaveBeenCalledTimes(1);
    expect(client.getRecords).toHaveBeenCalledWith(["rec-hidden", "rec-office", "rec-teacher"]);
  });

  it.each(["member", "created_by", "updated_by"] as const)(
    "shows %s names and reuses grid thumbnails, including through lookups",
    async (peopleType) => {
      const bounds = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(180);
      try {
        const person = {
          ...field,
          id: "people",
          slug: "people",
          name: "People",
          type: peopleType,
          position: 1,
        };
        const photo = {
          ...field,
          id: "photo",
          slug: "photo",
          name: "Photo",
          type: "attachment",
          position: 2,
        };
        const peopleLookup = {
          ...field,
          id: "people-lookup",
          slug: "people_lookup",
          name: "People lookup",
          type: "lookup",
          position: 3,
        };
        const photoLookup = {
          ...peopleLookup,
          id: "photo-lookup",
          slug: "photo_lookup",
          name: "Photo lookup",
          position: 4,
        };
        const richBase = {
          ...base,
          fields: [primary, person, photo, peopleLookup, photoLookup],
        } as unknown as RecordVO["base"];
        const files = [
          {
            id: "asset-private-id",
            fileName: "Cover.png",
            mimeType: "image/png",
            size: 100,
            url: "https://example.com/cover.png",
          },
          {
            id: "asset-second-id",
            fileName: "Second cover.png",
            mimeType: "image/png",
            size: 100,
            url: "https://example.com/second.png",
          },
        ];
        const candidate = {
          ...math,
          base: richBase,
          headCommit: {
            payload: {
              title: "Mathematics",
              people: ["usr-private-id", "usr-missing-id"],
              photo: files,
            },
          },
          fieldUsers: {
            "usr-private-id": { id: "usr-private-id", name: "王老师", email: "wang@example.com" },
          },
          computedFields: {
            people_lookup: {
              status: "ready",
              value: ["usr-private-id"],
              sources: [],
              targetField: person,
            },
            photo_lookup: { status: "ready", value: files, sources: [], targetField: photo },
          },
        } as unknown as RecordVO;
        const client = makeClient(
          vi.fn().mockResolvedValue({ records: [candidate], totalPages: 1 }),
        );
        vi.mocked(client.getBase).mockResolvedValue(richBase);
        mount(client, { initial: [], loaded: [] });
        fireEvent.click(screen.getByRole("button", { name: "Subjects" }));
        const card = (await screen.findByRole("checkbox", { name: "Mathematics" })).closest(
          "label",
        );
        if (!card) throw new Error("Missing candidate card");
        expect(within(card).getAllByText("王老师")).toHaveLength(2);
        expect(within(card).getByText("Unknown user")).toBeTruthy();
        expect(within(card).getAllByRole("img", { name: "Cover.png" })).toHaveLength(2);
        expect(within(card).queryByRole("img", { name: "Second cover.png" })).toBeNull();
        expect(card.querySelectorAll('[data-attachment-presentation="grid"]')).toHaveLength(2);
        expect(
          Array.from(card.querySelectorAll("[data-relation-preview-field]")).map((element) =>
            element.getAttribute("data-relation-preview-field"),
          ),
        ).toEqual(["people", "people_lookup", "photo", "photo_lookup"]);
        expect(card.textContent).not.toMatch(/usr-|asset-private-id/);
      } finally {
        bounds.mockRestore();
      }
    },
  );
});
