// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { DriveParsedTextPanel } from "./drive-parsed-text-panel";

const readTextLines = vi.fn();
const getAsset = vi.fn();

function makeOrpc() {
  return {
    assets: {
      get: {
        queryOptions: ({ input }: { input: { assetId: string } }) => ({
          queryKey: ["assets", "get", input.assetId],
          queryFn: () => getAsset(input.assetId),
        }),
      },
      readTextLines: {
        queryOptions: ({
          input,
        }: {
          input: { assetId: string; startLine: number; endLine: number };
        }) => ({
          queryKey: ["assets", "readTextLines", input.assetId, input.startLine, input.endLine],
          queryFn: () => readTextLines(input),
        }),
      },
    },
  } as unknown as BusabaseQueryUtils;
}

function renderPanel(assetId = "asset-pdf") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <CoreI18nProvider locale="en">
      <QueryClientProvider client={client}>
        <DriveParsedTextPanel
          assetId={assetId}
          filePath="policies/coverage.pdf"
          orpc={makeOrpc()}
        />
      </QueryClientProvider>
    </CoreI18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  getAsset.mockReset();
  readTextLines.mockReset();
});

describe("DriveParsedTextPanel", () => {
  it("loads the PDF's parsed text in bounded windows on demand", async () => {
    getAsset.mockResolvedValue({ asset: { textStatus: "present" } });
    readTextLines.mockImplementation(async ({ startLine }: { startLine: number }) =>
      startLine === 1
        ? {
            startLine: 1,
            endLine: 500,
            totalLines: 501,
            lines: Array.from({ length: 500 }, (_, index) => `Page line ${index + 1}`),
            truncated: false,
          }
        : {
            startLine: 501,
            endLine: 501,
            totalLines: 501,
            lines: ["Final line"],
            truncated: false,
          },
    );

    renderPanel();
    expect(await screen.findByText("Page line 1", { exact: false })).toBeTruthy();
    expect(readTextLines).toHaveBeenCalledWith({
      assetId: "asset-pdf",
      startLine: 1,
      endLine: 500,
    });
    expect(readTextLines).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByText("Final line", { exact: false })).toBeTruthy());
    expect(readTextLines).toHaveBeenCalledWith({
      assetId: "asset-pdf",
      startLine: 501,
      endLine: 1000,
    });
    expect(screen.getByText("Showing 1–501 of 501 lines")).toBeTruthy();
  });

  it.each([
    ["missing", "No parsed text has been supplied for this file yet."],
    ["none", "This file was marked as having no readable text."],
    ["stale", "This text may be outdated"],
  ])("shows %s without attempting to read text lines", async (status, expected) => {
    getAsset.mockResolvedValue({ asset: { textStatus: status } });
    renderPanel();

    expect(await screen.findByText(expected, { exact: false })).toBeTruthy();
    expect(readTextLines).not.toHaveBeenCalled();
  });

  it("shows a read error and allows retry", async () => {
    getAsset.mockResolvedValue({ asset: { textStatus: "present" } });
    readTextLines.mockRejectedValueOnce(new Error("Text read failed"));
    readTextLines.mockResolvedValueOnce({
      startLine: 1,
      endLine: 1,
      totalLines: 1,
      lines: ["Recovered text"],
      truncated: false,
    });
    renderPanel();

    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Recovered text")).toBeTruthy();
    expect(readTextLines).toHaveBeenCalledTimes(2);
  });
});
