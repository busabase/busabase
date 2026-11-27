// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  BaseFieldVO,
  BaseVO,
  LookupComputedVO,
  RecordVO,
  ViewVO,
} from "busabase-contract/types";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import type { RecordsPagination } from "../helpers/view-types";
import { useRecordFind } from "../hooks/use-record-find";

vi.mock("wouter", () => ({ useSearch: () => "" }));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

const { BusaBaseGallery } = await import("./base-gallery");

const fields: BaseFieldVO[] = [
  {
    id: "fld_title",
    baseId: "bas_gallery",
    slug: "title",
    name: "Title",
    type: "text",
    required: true,
    position: 0,
    options: {},
  },
  {
    id: "fld_cover",
    baseId: "bas_gallery",
    slug: "cover",
    name: "Cover",
    type: "attachment",
    required: false,
    position: 1,
    options: {},
  },
];

const base = {
  id: "bas_gallery",
  nodeId: "nod_gallery",
  slug: "gallery",
  name: "Gallery",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-09-15T00:00:00.000Z",
  fields,
} satisfies BaseVO;

const view = {
  id: "viw_gallery",
  baseId: base.id,
  slug: "gallery",
  name: "Gallery",
  description: "",
  type: "gallery",
  config: {
    filters: [],
    sorts: [],
    coverFieldSlug: "cover",
    coverFit: "cover",
  },
  status: "active",
  position: 0,
  createdBy: "usr_test",
  archivedAt: null,
  createdAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
} satisfies ViewVO;

const record = (cover: unknown): RecordVO =>
  ({
    id: "rec_gallery",
    baseId: base.id,
    headCommitId: "cmt_gallery",
    parentRecordId: null,
    parentCommitId: null,
    status: "active",
    createdBy: "usr_test",
    archivedAt: null,
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    base,
    headCommit: {
      id: "cmt_gallery",
      baseId: base.id,
      targetType: "base",
      nodeId: null,
      operationId: null,
      parentCommitId: null,
      payload: { title: "Sunset", cover },
      operation: "record_create",
      message: "",
      author: "usr_test",
      createdAt: "2026-09-15T00:00:00.000Z",
    },
  }) satisfies RecordVO;

function renderGallery(cover: unknown) {
  return render(
    <CoreI18nProvider locale="en">
      <BusaBaseGallery activeView={view} base={base} fields={fields} records={[record(cover)]} />
    </CoreI18nProvider>,
  );
}

afterEach(cleanup);

describe("Gallery shared record find", () => {
  const pagination = (patch: Partial<RecordsPagination> = {}): RecordsPagination => ({
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
    isLoading: false,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    ...patch,
  });
  function FindingGallery({
    records = [],
    archivedRecords = [],
    pageState = pagination(),
    commit = vi.fn(),
  }: {
    records?: RecordVO[];
    archivedRecords?: RecordVO[];
    pageState?: RecordsPagination;
    commit?: (value: { query: string; fieldId: string }) => void;
  }) {
    const [value, setValue] = useState({ query: "Sunset", fieldId: "" });
    const find = useRecordFind({
      value,
      scope: `${base.id}:${view.id}`,
      onCommit: (next) => {
        setValue(next);
        commit(next);
      },
    });
    return (
      <CoreI18nProvider locale="en">
        <BusaBaseGallery
          activeView={view}
          archivedRecords={archivedRecords}
          base={base}
          fields={fields}
          pagination={pageState}
          recordFind={find}
          records={records}
          showArchivedRecords
        />
      </CoreI18nProvider>
    );
  }

  it("distinguishes no matches from a failed query and offers clear or retry", () => {
    const commit = vi.fn();
    const retry = vi.fn();
    const { rerender } = render(<FindingGallery commit={commit} />);
    expect(screen.getByTestId("base-record-find-empty").textContent).toContain(
      "No matching records in this view.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear find" }));
    expect(commit).toHaveBeenCalledWith({ query: "", fieldId: "" });
    rerender(
      <FindingGallery
        pageState={pagination({ error: "Could not load records", onRetry: retry })}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Could not load records");
    expect(screen.queryByTestId("base-record-find-empty")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("does not present stale cards or unfiltered archived cards as search matches", () => {
    const found = record([]);
    const archived = {
      ...record([]),
      id: "rec_archived",
      headCommit: { ...found.headCommit, payload: { title: "Unrelated archive", cover: [] } },
    };
    const { rerender, container } = render(
      <FindingGallery archivedRecords={[archived]} records={[found]} />,
    );
    expect(container.querySelectorAll("[data-record-id]")).toHaveLength(1);
    expect(screen.queryByText("Unrelated archive")).toBeNull();
    rerender(
      <FindingGallery
        archivedRecords={[archived]}
        pageState={pagination({ isFetching: true, total: 1 })}
        records={[found]}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Finding records…");
    expect(container.querySelectorAll("[data-record-id]")).toHaveLength(0);
    expect(screen.queryByTestId("base-record-find-empty")).toBeNull();
  });
});

describe("BusaBaseGallery cover motion", () => {
  it("adds a short, reduced-motion-safe zoom only to a real cover image", () => {
    renderGallery([
      {
        id: "att_cover",
        url: "https://example.com/cover.jpg",
        fileName: "cover.jpg",
        mimeType: "image/jpeg",
        size: 1024,
      },
    ]);

    const cover = screen.getByRole("img", { name: "Sunset" });
    expect(cover.className).toContain("transition-transform");
    expect(cover.className).toContain("duration-150");
    expect(cover.className).toContain("motion-reduce:transition-none");
    expect(cover.className).toContain("motion-safe:pointer-fine:group-hover:scale-105");
  });

  it("does not apply zoom classes when the record has no image cover", () => {
    const { container } = renderGallery([]);

    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector(".transition-transform")).toBeNull();
  });
});

describe("BusaBaseGallery relation fields", () => {
  it("renders linked record titles for forward, reverse, and lookup relations", () => {
    const forwardRelationField: BaseFieldVO = {
      id: "fld_relation",
      baseId: base.id,
      slug: "related_lessons",
      name: "Related lessons",
      type: "relation",
      required: false,
      position: 2,
      options: {},
    };
    const reverseRelationField: BaseFieldVO = {
      id: "fld_reverse_relation",
      baseId: base.id,
      slug: "referenced_by",
      name: "Referenced by",
      type: "relation",
      required: false,
      position: 3,
      options: { reverseOfFieldId: forwardRelationField.id },
    };
    const lookupField: BaseFieldVO = {
      id: "fld_related_lookup",
      baseId: base.id,
      slug: "related_lookup",
      name: "Related lesson lookup",
      type: "lookup",
      required: false,
      position: 4,
      options: {
        lookup: { relationFieldSlug: "related_lessons", targetFieldSlug: "related_lessons" },
      },
    };
    const targetBase: BaseVO = {
      ...base,
      id: "bas_lessons",
      slug: "lessons",
      fields: fields.filter((field) => field.slug === "title"),
    };
    const source = {
      ...record([]),
      headCommit: {
        ...record([]).headCommit,
        payload: {
          title: "Gallery card",
          cover: [],
          related_lessons: [JSON.stringify([JSON.stringify(["rec_forward"])])],
          referenced_by: ["rec_reverse"],
        },
      },
      computedFields: {
        related_lookup: {
          status: "ready",
          value: ["rec_lookup"],
          targetField: forwardRelationField,
          sourceBaseId: targetBase.id,
          sourceBaseSlug: targetBase.slug,
          dependencyVersion: "test",
          sources: [],
        } satisfies LookupComputedVO,
      },
    } satisfies RecordVO;
    const linked = (id: string, title: string): RecordVO => ({
      ...record([]),
      id,
      baseId: targetBase.id,
      base: targetBase,
      headCommit: {
        ...record([]).headCommit,
        id: `cmt_${id}`,
        baseId: targetBase.id,
        payload: { title },
      },
    });

    render(
      <CoreI18nProvider locale="en">
        <BusaBaseGallery
          activeView={view}
          base={base}
          fields={[...fields, forwardRelationField, reverseRelationField, lookupField]}
          records={[source]}
          relationRecords={[
            source,
            linked("rec_forward", "Forward relation"),
            linked("rec_reverse", "Reverse relation"),
            linked("rec_lookup", "Lookup relation"),
          ]}
        />
      </CoreI18nProvider>,
    );

    for (const [name, id] of [
      ["Forward relation", "rec_forward"],
      ["Reverse relation", "rec_reverse"],
      ["Lookup relation", "rec_lookup"],
    ] as const) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(`/base/lessons/${id}`);
      expect(screen.queryByText(id)).toBeNull();
    }
  });
});

describe("BusaBaseGallery members", () => {
  it("uses resolved member names instead of the stored user ids", () => {
    const memberField: BaseFieldVO = {
      id: "fld_member",
      baseId: base.id,
      slug: "members",
      name: "Members",
      type: "member",
      required: false,
      position: 2,
      options: {},
    };
    const source = record([]);
    source.headCommit.payload.members = ["opaque-user-id-one", "opaque-user-id-two"];
    source.fieldUsers = {
      "opaque-user-id-one": { id: "opaque-user-id-one", name: "张三", email: null, image: null },
      "opaque-user-id-two": { id: "opaque-user-id-two", name: "李四", email: null, image: null },
    };
    render(
      <CoreI18nProvider locale="en">
        <BusaBaseGallery
          activeView={view}
          base={base}
          fields={[...fields, memberField]}
          records={[source]}
        />
      </CoreI18nProvider>,
    );
    expect(screen.getByText("张三")).toBeTruthy();
    expect(screen.getByText("李四")).toBeTruthy();
    expect(screen.queryByText("opaque-user-id-one")).toBeNull();
    expect(screen.queryByText("opaque-user-id-two")).toBeNull();
  });
});

describe("BusaBaseGallery video covers", () => {
  const video = {
    id: "att_clip",
    url: "https://example.com/clip.mp4",
    fileName: "clip.mp4",
    mimeType: "video/mp4",
    size: 4096,
  };

  it("draws a video-only cell as a muted first-frame cover with a play badge", () => {
    const { container } = renderGallery([video]);

    const element = container.querySelector("video");
    if (!element) throw new Error("Expected a video cover");
    expect(element.getAttribute("src")).toBe("https://example.com/clip.mp4#t=0.1");
    expect(element.getAttribute("preload")).toBe("metadata");
    expect(element.muted).toBe(true);
    expect(element.hasAttribute("autoplay")).toBe(false);
    expect(element.hasAttribute("controls")).toBe(false);
    expect(element.className).toContain("motion-safe:pointer-fine:group-hover:scale-105");
    expect(container.querySelector("[data-cover-video] svg")).not.toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("prefers an image over a video in the same cell", () => {
    const { container } = renderGallery([
      video,
      {
        id: "att_poster",
        url: "https://example.com/poster.jpg",
        fileName: "poster.jpg",
        mimeType: "image/jpeg",
        size: 1024,
      },
    ]);

    expect(screen.getByRole("img", { name: "Sunset" }).getAttribute("src")).toBe(
      "https://example.com/poster.jpg",
    );
    expect(container.querySelector("video")).toBeNull();
  });

  it("falls back to the title initial when the video cannot load", () => {
    const { container } = renderGallery([video]);

    const element = container.querySelector("video");
    if (!element) throw new Error("Expected a video cover");
    fireEvent.error(element);

    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector(".text-2xl")?.textContent).toBe("S");
  });
});
