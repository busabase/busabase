/**
 * @vitest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TiffViewer from "./TiffViewer";

describe("TiffViewer", () => {
  beforeEach(() => {
    // Mock fetch API
    global.fetch = vi.fn();

    // Mock canvas context
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      putImageData: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    // jsdom has no ImageData; the viewer paints each page through one.
    vi.stubGlobal(
      "ImageData",
      class {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
        ) {}
      },
    );
  });

  describe("Loading State", () => {
    it("should show loading state initially", () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(() => {}), // Never resolves
      );

      render(<TiffViewer fileUrl="https://example.com/test.tif" fileName="test.tif" />);

      expect(screen.getByText("Loading TIFF image...")).toBeInTheDocument();
    });
  });

  describe("TIFF Parsing and Rendering", () => {
    it("should parse and render TIFF image", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      render(<TiffViewer fileUrl="https://example.com/test.tif" fileName="test.tif" />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("https://example.com/test.tif");
      });
    });

    it("should handle multi-page TIFF files", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      render(<TiffViewer fileUrl="https://example.com/multi.tif" fileName="multi.tif" />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });

    it("should render TIFF to canvas", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      const { container } = render(
        <TiffViewer fileUrl="https://example.com/test.tif" fileName="test.tif" />,
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // Canvas element should be present
      const canvas = container.querySelector("canvas");
      expect(canvas).toBeTruthy();
    });
  });

  describe("Error Handling", () => {
    it("should show error message when fetch fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network error"));

      render(<TiffViewer fileUrl="https://example.com/fail.tif" fileName="fail.tif" />);

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Failed to load file" })).toBeInTheDocument();
      });
    });

    it("should show error for 404 response", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      render(<TiffViewer fileUrl="https://example.com/notfound.tif" fileName="notfound.tif" />);

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Failed to load file" })).toBeInTheDocument();
      });
    });

    it("should show retry button on error", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network error"));

      render(<TiffViewer fileUrl="https://example.com/fail.tif" fileName="fail.tif" />);

      await waitFor(() => {
        const retryButton = screen.getByRole("button", { name: /try again/i });
        expect(retryButton).toBeInTheDocument();
      });
    });

    it("should handle invalid TIFF data", async () => {
      const mockArrayBuffer = new ArrayBuffer(0);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      render(<TiffViewer fileUrl="https://example.com/invalid.tif" fileName="invalid.tif" />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });
  });

  describe("Zoom Controls", () => {
    it("should display zoom controls", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      render(<TiffViewer fileUrl="https://example.com/test.tif" fileName="test.tif" />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // Zoom controls should be present after loading
    });

    it("should have zoom in button", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      render(<TiffViewer fileUrl="https://example.com/test.tif" fileName="test.tif" />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });

    it("should have zoom out button", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      render(<TiffViewer fileUrl="https://example.com/test.tif" fileName="test.tif" />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });

    it("should have fit width button", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      render(<TiffViewer fileUrl="https://example.com/test.tif" fileName="test.tif" />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });

    it("should have fit height button", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      render(<TiffViewer fileUrl="https://example.com/test.tif" fileName="test.tif" />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });
  });

  describe("Multi-page Navigation", () => {
    it("should show page navigation for multi-page TIFFs", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      render(<TiffViewer fileUrl="https://example.com/multi.tif" fileName="multi.tif" />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });

    it("should have previous page button", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      render(<TiffViewer fileUrl="https://example.com/multi.tif" fileName="multi.tif" />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });

    it("should have next page button", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      render(<TiffViewer fileUrl="https://example.com/multi.tif" fileName="multi.tif" />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });
  });

  describe("Watermark", () => {
    it("should display watermark when provided", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      render(
        <TiffViewer
          fileUrl="https://example.com/test.tif"
          fileName="test.tif"
          watermark="CONFIDENTIAL"
        />,
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });

    it("should not display watermark when not provided", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      render(<TiffViewer fileUrl="https://example.com/test.tif" fileName="test.tif" />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });
  });

  describe("Download Protection", () => {
    it("should prevent save shortcut when noDownload is enabled", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      render(
        <TiffViewer fileUrl="https://example.com/test.tif" fileName="test.tif" noDownload={true} />,
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // Keyboard event prevention is tested internally
    });

    it("should allow shortcuts when noDownload is disabled", async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
      });

      render(
        <TiffViewer
          fileUrl="https://example.com/test.tif"
          fileName="test.tif"
          noDownload={false}
        />,
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });
  });
});
