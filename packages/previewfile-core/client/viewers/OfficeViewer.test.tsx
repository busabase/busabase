/**
 * Focused unit tests for OfficeViewer's conversion metadata construction
 * (PUL-201). These pin that `accessPassword` is forwarded to the converter
 * verbatim as an explicit prop, and — critically — that OfficeViewer never
 * tries to infer a credential from `fileUrl` itself. Earlier revisions of
 * this fix parsed a `pwd`/`password` query param off `fileUrl`, which broke
 * for large files (client only ever sees a presigned URL, no proxy `pwd`
 * param), direct-URL preview sessions, and could misfire on an unrelated
 * password-like query parameter on a source URL. `accessPassword` must be
 * the sole source of the forwarded credential.
 */

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OfficeViewer from "./OfficeViewer";

const { mockUseConverter, mockConvertToPdf } = vi.hoisted(() => ({
  mockUseConverter: vi.fn(),
  mockConvertToPdf: vi.fn(),
}));

vi.mock("../converter", () => ({
  useConverter: mockUseConverter,
}));

describe("OfficeViewer conversion metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConvertToPdf.mockResolvedValue({ pdfUrl: "https://example.com/out.pdf" });
    mockUseConverter.mockReturnValue({ convertToPdf: mockConvertToPdf });
  });

  it("omits metadata when neither shortUrl nor accessPassword is provided", async () => {
    render(<OfficeViewer fileUrl="https://example.com/doc.pptx" fileName="doc.pptx" />);

    await waitFor(() => expect(mockConvertToPdf).toHaveBeenCalled());

    expect(mockConvertToPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        fileUrl: "https://example.com/doc.pptx",
        metadata: undefined,
      }),
    );
  });

  it("forwards the explicit accessPassword prop as metadata.password", async () => {
    render(
      <OfficeViewer
        fileUrl="https://example.com/doc.pptx"
        fileName="doc.pptx"
        shortUrl="abc123"
        accessPassword="11"
      />,
    );

    await waitFor(() => expect(mockConvertToPdf).toHaveBeenCalled());

    expect(mockConvertToPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { shortUrl: "abc123", password: "11" },
      }),
    );
  });

  it("does not infer a credential from a pwd/password query param on fileUrl", async () => {
    // A fileUrl that happens to carry a `pwd` query param (e.g. a proxy URL
    // from a different, unrelated flow, or a source URL that just happens to
    // have a same-named param) must NOT leak into the conversion metadata
    // unless the caller explicitly passed accessPassword.
    render(
      <OfficeViewer
        fileUrl="https://example.com/doc.pptx?pwd=should-not-be-used"
        fileName="doc.pptx"
        shortUrl="abc123"
      />,
    );

    await waitFor(() => expect(mockConvertToPdf).toHaveBeenCalled());

    expect(mockConvertToPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        fileUrl: "https://example.com/doc.pptx?pwd=should-not-be-used",
        metadata: { shortUrl: "abc123" },
      }),
    );
  });

  it("forwards the share link and the verified password with the conversion", async () => {
    render(
      <OfficeViewer
        fileUrl="https://cdn.example.com/proxy/doc.pptx"
        fileName="doc.pptx"
        shortUrl="abc123"
        accessPassword="secret"
      />,
    );

    await waitFor(() => expect(mockConvertToPdf).toHaveBeenCalled());

    expect(mockConvertToPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        fileUrl: "https://cdn.example.com/proxy/doc.pptx",
        metadata: { shortUrl: "abc123", password: "secret" },
      }),
    );
  });

  it("ignores an empty accessPassword", async () => {
    render(
      <OfficeViewer
        fileUrl="https://example.com/doc.pptx"
        fileName="doc.pptx"
        shortUrl="abc123"
        accessPassword=""
      />,
    );

    await waitFor(() => expect(mockConvertToPdf).toHaveBeenCalled());

    expect(mockConvertToPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { shortUrl: "abc123" },
      }),
    );
  });

  it("restarts conversion when the session identity or credential changes", async () => {
    const { rerender } = render(
      <OfficeViewer
        fileUrl="https://example.com/first.pptx"
        fileName="doc.pptx"
        shortUrl="first"
        accessPassword="old-password"
      />,
    );

    await waitFor(() => expect(mockConvertToPdf).toHaveBeenCalledTimes(1));

    rerender(
      <OfficeViewer
        fileUrl="https://example.com/second.pptx"
        fileName="doc.pptx"
        shortUrl="second"
        accessPassword="new-password"
      />,
    );

    await waitFor(() => expect(mockConvertToPdf).toHaveBeenCalledTimes(2));
    expect(mockConvertToPdf).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fileUrl: "https://example.com/second.pptx",
        metadata: { shortUrl: "second", password: "new-password" },
      }),
    );
  });
});
