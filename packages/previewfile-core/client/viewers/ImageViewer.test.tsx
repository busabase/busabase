import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ImageViewer from "./ImageViewer";
import { ViewerLayoutProvider } from "./viewer-layout";

describe("ImageViewer container fitting", () => {
  it("uses a definite height and intrinsic sizing so portrait, landscape and small images stay proportional", () => {
    const { container } = render(
      <ViewerLayoutProvider layout="fill">
        <ImageViewer fileName="photo.png" fileUrl="/photo.png" fitToContainer />
      </ViewerLayoutProvider>,
    );
    const root = container.firstElementChild;
    const image = screen.getByRole("img", { name: "photo.png" });
    expect(root).toHaveClass("h-full", "min-h-0", "overflow-hidden");
    expect(root).not.toHaveClass("min-h-full");
    expect(image).toHaveClass("h-auto", "w-auto", "max-w-full", "max-h-full", "object-contain");
    expect(image).not.toHaveClass("h-full", "w-full");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("draggable", "false");
    expect(screen.queryByRole("button")).toBeNull();
    const wheel = new WheelEvent("wheel", { deltaY: 100, ctrlKey: true, cancelable: true });
    fireEvent(image, wheel);
    expect(wheel.defaultPrevented).toBe(false);
    fireEvent.load(image);
    expect(image).toHaveClass("opacity-100");
  });

  it("preserves the watermark and disabled context menu", () => {
    render(
      <ImageViewer
        fileName="photo.png"
        fileUrl="/photo.png"
        fitToContainer
        noDownload
        watermark="Confidential"
      />,
    );
    expect(screen.getByText("Confidential")).toBeVisible();
    expect(fireEvent.contextMenu(screen.getByRole("img"))).toBe(false);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("Failed to load image", { selector: "p" })).toBeVisible();
  });

  it("preserves the legacy viewport minimum and contain sizing by default", () => {
    const { container } = render(<ImageViewer fileName="photo.png" fileUrl="/photo.png" />);
    expect(container.firstElementChild).toHaveClass("min-h-[100vh]");
    expect(container.firstElementChild).not.toHaveClass("h-full", "overflow-hidden");
    expect(screen.getByRole("img")).toHaveClass("max-w-full", "max-h-full", "object-contain");
    expect(screen.getByRole("img")).not.toHaveClass("object-scale-down");
    expect(fireEvent.contextMenu(screen.getByRole("img"))).toBe(true);
  });
});
