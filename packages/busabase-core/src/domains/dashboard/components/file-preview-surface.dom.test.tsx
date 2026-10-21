// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { FilePreviewSurface } from "./file-preview-surface";
import { FileViewerSlotProvider, type HostFileViewer } from "./file-viewer-slot";
import {
  PreviewFullscreenButton,
  type PreviewFullscreenState,
  usePreviewFullscreen,
} from "./preview-fullscreen";

function Providers({ children }: { children: ReactNode }) {
  return <CoreI18nProvider locale="en">{children}</CoreI18nProvider>;
}

function UrlFullscreenHarness({ mimeType }: { mimeType: string }) {
  const fullscreenState = usePreviewFullscreen({ syncWithUrl: true });
  return (
    <Providers>
      <PreviewFullscreenButton
        fullscreenState={fullscreenState}
        label={coreMessagesByLocale.en.airapp.enterFullscreen}
      />
      <FilePreviewSurface
        fullscreenState={fullscreenState}
        mimeType={mimeType}
        name="preview-file"
        url="/preview-file"
      />
    </Providers>
  );
}

function LocalFullscreenHarness({ mimeType }: { mimeType: string }) {
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenState: PreviewFullscreenState = { fullscreen, setFullscreen };
  return (
    <Providers>
      <FilePreviewSurface
        fullscreenState={fullscreenState}
        mimeType={mimeType}
        name="pinned-file"
        showToolbar
        url="/pinned-file"
      />
    </Providers>
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("FilePreviewSurface", () => {
  it.each([
    ["image/svg+xml", "img"],
    ["video/mp4", "video"],
    ["application/pdf", "iframe"],
  ])("renders the %s native media branch", (mimeType, selector) => {
    const state: PreviewFullscreenState = { fullscreen: false, setFullscreen: () => undefined };
    const { container } = render(
      <Providers>
        <FilePreviewSurface
          fullscreenState={state}
          mimeType={mimeType}
          name="native-preview"
          url="/native-preview"
        />
      </Providers>,
    );

    expect(container.querySelector(selector)).not.toBeNull();
    expect(container.querySelector("[data-file-media-frame]")).not.toBeNull();
  });

  it("renders the inline PDF edge-to-edge without a viewport height cap", () => {
    const state: PreviewFullscreenState = { fullscreen: false, setFullscreen: () => undefined };
    const { container } = render(
      <Providers>
        <FilePreviewSurface
          fullscreenState={state}
          mimeType="application/pdf"
          name="report.pdf"
          url="/report.pdf"
        />
      </Providers>,
    );

    const body = container.querySelector<HTMLElement>("[data-preview-fullscreen-body]");
    const frame = container.querySelector<HTMLElement>("[data-file-media-frame]");
    const pdf = container.querySelector<HTMLIFrameElement>('[data-asset-preview="pdf"]');

    expect(body?.classList.contains("p-0")).toBe(true);
    expect(body?.classList.contains("p-4")).toBe(false);
    expect(body?.classList.contains("md:p-6")).toBe(false);
    expect(frame?.classList.contains("h-full")).toBe(true);
    expect(frame?.classList.contains("min-h-0")).toBe(true);
    expect(frame?.classList.contains("w-full")).toBe(true);
    expect(frame?.classList.contains("rounded-md")).toBe(false);
    expect(frame?.classList.contains("border")).toBe(false);
    expect(frame?.classList.contains("max-w-5xl")).toBe(false);
    expect(pdf?.classList.contains("h-full")).toBe(true);
    expect(pdf?.classList.contains("max-h-full")).toBe(true);
    expect(pdf?.className).not.toContain("vh");
  });

  it.each([
    ["image/svg+xml", "img"],
    ["video/mp4", "video"],
  ])("keeps inline %s media contained within the existing viewport cap", (mimeType, selector) => {
    const state: PreviewFullscreenState = { fullscreen: false, setFullscreen: () => undefined };
    const { container } = render(
      <Providers>
        <FilePreviewSurface
          fullscreenState={state}
          mimeType={mimeType}
          name="contained-preview"
          url="/contained-preview"
        />
      </Providers>,
    );

    const body = container.querySelector<HTMLElement>("[data-preview-fullscreen-body]");
    const frame = container.querySelector<HTMLElement>("[data-file-media-frame]");
    const media = container.querySelector<HTMLElement>(selector);
    expect(body?.classList.contains("p-4")).toBe(true);
    expect(body?.classList.contains("md:p-6")).toBe(true);
    expect(frame?.classList.contains("min-h-[320px]")).toBe(true);
    expect(frame?.classList.contains("max-w-5xl")).toBe(true);
    expect(frame?.classList.contains("rounded-md")).toBe(true);
    expect(frame?.classList.contains("border")).toBe(true);
    expect(media?.classList.contains("max-h-[65vh]")).toBe(true);
    expect(media?.classList.contains("object-contain")).toBe(true);
  });

  it("keeps the same main video and playback position through URL fullscreen", async () => {
    window.history.replaceState(null, "", "/dashboard/file?demo=node-types");
    const { container } = render(<UrlFullscreenHarness mimeType="video/mp4" />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (video) video.currentTime = 12.5;

    fireEvent.click(
      screen.getByRole("button", { name: coreMessagesByLocale.en.airapp.enterFullscreen }),
    );

    await waitFor(() =>
      expect(container.querySelector('[data-file-fullscreen="true"]')).not.toBeNull(),
    );
    expect(container.querySelector("video")).toBe(video);
    expect((container.querySelector("video") as HTMLVideoElement).currentTime).toBe(12.5);
    expect(window.location.search).toContain("demo=node-types");
    expect(window.location.search).toContain("fullscreen=1");

    fireEvent.click(
      screen.getByRole("button", { name: coreMessagesByLocale.en.airapp.exitFullscreen }),
    );
    await waitFor(() =>
      expect(container.querySelector('[data-file-fullscreen="true"]')).toBeNull(),
    );
    expect(container.querySelector("video")).toBe(video);
    expect(window.location.search).toBe("?demo=node-types");
  });

  it("keeps Side Panel fullscreen local and preserves the current URL", async () => {
    window.history.replaceState(null, "", "/dashboard/home?demo=node-types");
    const { container } = render(<LocalFullscreenHarness mimeType="image/svg+xml" />);
    const image = container.querySelector("img");

    fireEvent.click(
      screen.getByRole("button", { name: coreMessagesByLocale.en.airapp.enterFullscreen }),
    );
    await waitFor(() =>
      expect(container.querySelector('[data-file-fullscreen="true"]')).not.toBeNull(),
    );
    expect(container.querySelector("img")).toBe(image);
    expect(window.location.pathname).toBe("/dashboard/home");
    expect(window.location.search).toBe("?demo=node-types");
  });

  it.each([
    ["audio/mpeg", "audio"],
    ["application/zip", "a"],
  ])("does not offer fullscreen for %s", (mimeType, selector) => {
    const { container } = render(<LocalFullscreenHarness mimeType={mimeType} />);

    expect(container.querySelector(selector)).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: coreMessagesByLocale.en.airapp.enterFullscreen }),
    ).toBeNull();
  });

  it("clears an unsupported deep-link fullscreen request", async () => {
    window.history.replaceState(null, "", "/dashboard/file?demo=node-types&fullscreen=1");
    const { container } = render(<UrlFullscreenHarness mimeType="audio/mpeg" />);

    await waitFor(() => expect(window.location.search).toBe("?demo=node-types"));
    expect(container.querySelector('[data-file-fullscreen="true"]')).toBeNull();
    expect(
      screen.queryByRole("button", { name: coreMessagesByLocale.en.airapp.exitFullscreen }),
    ).toBeNull();
  });
});

describe("FilePreviewSurface with a host file viewer", () => {
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const spreadsheetViewer: HostFileViewer = {
    canRender: (file) => file.name.endsWith(".xlsx") || file.name.endsWith(".pdf"),
    render: (file) => <div data-testid="host-viewer">{`${file.name}|${file.url}`}</div>,
  };

  function renderSurface(
    file: { mimeType: string; name: string },
    viewer: HostFileViewer | null = spreadsheetViewer,
  ) {
    const state: PreviewFullscreenState = { fullscreen: false, setFullscreen: () => undefined };
    const surface = (
      <FilePreviewSurface
        fullscreenState={state}
        mimeType={file.mimeType}
        name={file.name}
        showToolbar
        url="/agency.bin"
      />
    );
    return render(
      <Providers>
        {viewer ? (
          <FileViewerSlotProvider value={viewer}>{surface}</FileViewerSlotProvider>
        ) : (
          surface
        )}
      </Providers>,
    );
  }

  it("hands a format the built-in preview cannot show to the host, edge-to-edge and fullscreen-able", () => {
    const { container } = renderSurface({ mimeType: XLSX_MIME, name: "agency.xlsx" });

    expect(screen.getByTestId("host-viewer").textContent).toBe("agency.xlsx|/agency.bin");
    expect(screen.queryByText(coreMessagesByLocale.en.assets.openFile)).toBeNull();
    const body = container.querySelector<HTMLElement>("[data-preview-fullscreen-body]");
    const frame = container.querySelector<HTMLElement>("[data-file-media-frame]");
    expect(body?.classList.contains("p-0")).toBe(true);
    expect(frame?.classList.contains("max-w-5xl")).toBe(false);
    expect(container.querySelector('[data-asset-preview="host"]')).not.toBeNull();
    expect(
      screen.getByRole("button", { name: coreMessagesByLocale.en.airapp.enterFullscreen }),
    ).toBeTruthy();
  });

  it("lets the host take a PDF it claims", () => {
    const { container } = renderSurface({ mimeType: "application/pdf", name: "report.pdf" });

    expect(screen.getByTestId("host-viewer").textContent).toBe("report.pdf|/agency.bin");
    expect(container.querySelector('[data-asset-preview="pdf"]')).toBeNull();
  });

  it("keeps the built-in preview for a format the browser renders and the host declines", () => {
    const { container } = renderSurface(
      { mimeType: "application/pdf", name: "report.pdf" },
      {
        canRender: (file) => file.name.endsWith(".xlsx"),
        render: () => <div data-testid="host-viewer" />,
      },
    );

    expect(container.querySelector('[data-asset-preview="pdf"]')).not.toBeNull();
    expect(screen.queryByTestId("host-viewer")).toBeNull();
  });

  it("falls back to the open-file link for a format the host declines", () => {
    renderSurface({ mimeType: "application/zip", name: "bundle.zip" });

    expect(screen.queryByTestId("host-viewer")).toBeNull();
    expect(screen.getByText(coreMessagesByLocale.en.assets.openFile)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: coreMessagesByLocale.en.airapp.enterFullscreen }),
    ).toBeNull();
  });

  it("keeps the open-file link when no host registered a viewer (open-source build)", () => {
    renderSurface({ mimeType: XLSX_MIME, name: "agency.xlsx" }, null);

    expect(screen.getByText(coreMessagesByLocale.en.assets.openFile)).toBeTruthy();
  });
});

describe("FilePreviewSurface text File nodes", () => {
  /** `orpc` whose `assets.readTextLines` answers with `lines` (or rejects). */
  const textOrpc = (read: { lines: string[]; totalLines?: number } | Error) =>
    ({
      assets: {
        readTextLines: {
          queryOptions: (options: { input: unknown }) => ({
            queryKey: ["assets", "readTextLines", options.input],
            queryFn: async () => {
              if (read instanceof Error) throw read;
              return {
                lines: read.lines,
                startLine: 1,
                endLine: 2000,
                totalLines: read.totalLines ?? read.lines.length,
                truncated: false,
              };
            },
          }),
        },
      },
    }) as unknown as BusabaseQueryUtils;

  const renderText = (
    file: { name: string; mimeType: string; size?: number },
    read: Parameters<typeof textOrpc>[0],
    viewer: HostFileViewer | null = null,
  ) => {
    const state: PreviewFullscreenState = { fullscreen: false, setFullscreen: () => undefined };
    const surface = (
      <FilePreviewSurface
        fullscreenState={state}
        mimeType={file.mimeType}
        name={file.name}
        textSource={{
          orpc: textOrpc(read),
          asset: {
            id: "ast_1",
            name: file.name,
            mimeType: file.mimeType,
            contentKind: "text",
            textStatus: "present",
            size: file.size ?? 64,
          },
        }}
        url="/file.bin"
      />
    );
    return render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Providers>
          {viewer ? (
            <FileViewerSlotProvider value={viewer}>{surface}</FileViewerSlotProvider>
          ) : (
            surface
          )}
        </Providers>
      </QueryClientProvider>,
    );
  };

  it("renders a Markdown file the way a Drive does", async () => {
    const { container } = renderText(
      { name: "notes.md", mimeType: "text/markdown" },
      {
        lines: ["# Launch notes", "", "- Northwind pilot"],
      },
    );

    expect(await screen.findByRole("heading", { name: "Launch notes" })).toBeTruthy();
    expect(container.querySelector('[data-file-text-preview="markdown"]')).not.toBeNull();
    expect(screen.queryByText(coreMessagesByLocale.en.assets.openFile)).toBeNull();
  });

  it("renders code with line numbers", async () => {
    const { container } = renderText(
      { name: "main.py", mimeType: "text/x-python" },
      {
        lines: ["def greet(name):", '    return f"hello {name}"'],
      },
    );

    await waitFor(() =>
      expect(container.querySelector('[data-file-text-preview="code"]')).not.toBeNull(),
    );
    expect(container.textContent).toContain("def greet(name):");
  });

  it("lets a host viewer that claims the file go first", () => {
    renderText(
      { name: "export.csv", mimeType: "text/csv" },
      { lines: ["a,b"] },
      {
        canRender: (file) => file.name.endsWith(".csv"),
        render: () => <div data-testid="host-viewer" />,
      },
    );

    expect(screen.getByTestId("host-viewer")).toBeTruthy();
  });

  it.each([
    ["too many lines", { lines: ["a", "b"], totalLines: 5000 }],
    ["not UTF-8", { lines: ["\uFFFD\uFFFD"] }],
    ["a failed read", new Error("forbidden")],
  ])("keeps the open-file link for %s", async (_label, read) => {
    renderText({ name: "notes.md", mimeType: "text/markdown" }, read);

    expect(await screen.findByText(coreMessagesByLocale.en.assets.openFile)).toBeTruthy();
  });
});
