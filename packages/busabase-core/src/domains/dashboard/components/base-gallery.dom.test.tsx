// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";

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
