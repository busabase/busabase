// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  CreatedEmbedLinkVO,
  EmbedLinkVO,
} from "busabase-contract/contract/embed-link-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { EmbedLinkSection } from "./embed-link-section";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,dGVzdA==") },
}));

const activeLink: EmbedLinkVO = {
  id: "emb_active",
  type: "node",
  typeId: "nod_handbook",
  targetName: "Handbook",
  nodeType: "doc",
  createdAt: "2026-09-22T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  revokedAt: null,
  active: true,
  framePolicy: { mode: "origins", allowedOrigins: ["https://example.com"] },
};

const expiredLink: EmbedLinkVO = {
  ...activeLink,
  id: "emb_expired",
  active: false,
  expiresAt: "2020-01-01T00:00:00.000Z",
};

const createdLink: CreatedEmbedLinkVO = {
  ...activeLink,
  id: "emb_created",
  url: "https://busabase.com/embed/emb_created?token=fixture-secret",
  iframeUrl: "https://busabase.com/embed/emb_created?token=fixture-secret&view=iframe",
};

const stubOrpc = () =>
  ({
    embedLinks: {
      list: {
        key: () => ["embedLinks", "list"],
        queryOptions: () => ({
          queryKey: ["embedLinks", "list", "nod_handbook"],
          queryFn: vi.fn(async () => [activeLink, expiredLink]),
        }),
      },
      create: { mutationOptions: () => ({ mutationFn: vi.fn(async () => createdLink) }) },
      revoke: { mutationOptions: () => ({ mutationFn: vi.fn(async () => ({ revoked: true })) }) },
    },
  }) as unknown as BusabaseQueryUtils;

const renderSection = (onUncopiedSecretChange = vi.fn()) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <CoreI18nProvider locale="en">
      <QueryClientProvider client={client}>
        <EmbedLinkSection
          divider={false}
          onUncopiedSecretChange={onUncopiedSecretChange}
          orpc={stubOrpc()}
          target={{ type: "node", typeId: "nod_handbook", nodeType: "doc" }}
        />
      </QueryClientProvider>
    </CoreI18nProvider>,
  );
  return onUncopiedSecretChange;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EmbedLinkSection", () => {
  it("uses restricted origins by default and separates active links from history", async () => {
    renderSection();

    expect(screen.getByLabelText("Allowed sites")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create embed link" }).hasAttribute("disabled")).toBe(
      true,
    );
    await screen.findByText("Handbook");
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.queryByText("Expired")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "History (1)" }));
    expect(await screen.findByText("Expired")).toBeTruthy();
  });

  it("protects a newly created one-time link until either value is copied", async () => {
    const onUncopiedSecretChange = renderSection();
    expect(screen.queryByRole("button", { name: "QR code" })).toBeNull();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    fireEvent.change(screen.getByLabelText("Allowed sites"), {
      target: { value: "https://docs.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create embed link" }));

    const created = await screen.findByTestId("embed-link-created");
    const qrTrigger = within(created).getByRole("button", { name: "QR code" });
    qrTrigger.focus();
    fireEvent.click(qrTrigger);
    const qrPopup = await screen.findByRole("dialog", { name: "QR code" });
    expect(created.contains(qrPopup)).toBe(false);
    expect(await within(qrPopup).findByAltText("QR code for this link")).toBeTruthy();
    const { default: QRCode } = await import("qrcode");
    expect(QRCode.toDataURL).toHaveBeenCalledWith(createdLink.iframeUrl, expect.any(Object));
    expect(onUncopiedSecretChange).toHaveBeenCalledWith(true);
    expect(onUncopiedSecretChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(qrPopup, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "QR code" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(qrTrigger));
    expect(screen.getByTestId("embed-link-created")).toBe(created);
    expect(within(created).getByTestId("embed-link-created-url")).toHaveProperty(
      "value",
      createdLink.iframeUrl,
    );
    expect(onUncopiedSecretChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(within(created).getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(onUncopiedSecretChange).toHaveBeenLastCalledWith(false));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(createdLink.iframeUrl);
    expect(
      within(created).getByText("Copied. This one-time link is safe to close now."),
    ).toBeTruthy();

    const snippet = within(created).getByTestId<HTMLTextAreaElement>(
      "embed-link-created-iframe",
    ).value;
    const iframe = new DOMParser().parseFromString(snippet, "text/html").querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe(createdLink.iframeUrl);
    fireEvent.click(within(created).getByRole("button", { name: "Copy embed code" }));
    await waitFor(() => expect(writeText).toHaveBeenNthCalledWith(2, snippet));
    expect(onUncopiedSecretChange).toHaveBeenLastCalledWith(false);
  });
});
