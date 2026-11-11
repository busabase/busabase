import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { MessagesProvider } from "../i18n";
import AudioViewer from "./AudioViewer";
import { ModelFrame } from "./model-frame";
import { ZoomableCanvas } from "./zoomable-canvas";

const renderCanvas = (onKey = vi.fn()) => {
  const utils = render(
    <ZoomableCanvas
      canvasRef={createRef<HTMLCanvasElement>()}
      controls={<button type="button">Next page</button>}
      fileName="scan.tiff"
      guardContent={false}
      height={200}
      hint="Use Ctrl/Cmd + Scroll to zoom"
      info={<span>Page 1 of 2</span>}
      onKey={onKey}
      width={400}
    />,
  );
  const canvas = utils.container.querySelector("canvas") as HTMLCanvasElement;
  const select = screen.getByRole("combobox") as HTMLSelectElement;
  return { ...utils, canvas, select, onKey };
};

describe("ZoomableCanvas (TIFF, PSD)", () => {
  it("shows the file, its size, what the viewer adds and the hint", () => {
    renderCanvas();
    expect(screen.getByText("scan.tiff")).toBeTruthy();
    expect(screen.getByText("400 × 200px")).toBeTruthy();
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next page" })).toBeTruthy();
    expect(screen.getByText("Use Ctrl/Cmd + Scroll to zoom")).toBeTruthy();
  });

  it("zooms through the levels and back to 100% when the fit in use is picked again", () => {
    const { canvas, select } = renderCanvas();
    expect(select.value).toBe("width");

    fireEvent.click(screen.getByTitle("Zoom in (Ctrl/Cmd + +)"));
    expect(select.value).toBe("125");
    expect(canvas.style.width).toBe("500px");
    expect(canvas.style.imageRendering).toBe("pixelated");

    fireEvent.click(screen.getByTitle("Zoom out (Ctrl/Cmd + -)"));
    fireEvent.click(screen.getByTitle("Zoom out (Ctrl/Cmd + -)"));
    expect(select.value).toBe("75");
    expect(canvas.style.width).toBe("300px");

    fireEvent.change(select, { target: { value: "200" } });
    expect(canvas.style.width).toBe("800px");

    fireEvent.click(screen.getByTitle("Fit to height"));
    expect(select.value).toBe("height");
    fireEvent.click(screen.getByTitle("Fit to height"));
    expect(select.value).toBe("100");
    expect(canvas.style.width).toBe("400px");
  });

  it("takes the zoom keys itself and hands any other key to the viewer", () => {
    const { container, select, onKey } = renderCanvas();
    const root = container.firstElementChild as HTMLElement;

    fireEvent.keyDown(root, { key: "=", ctrlKey: true });
    expect(select.value).toBe("125");
    fireEvent.keyDown(root, { key: "0", ctrlKey: true });
    expect(select.value).toBe("100");
    expect(onKey).not.toHaveBeenCalled();

    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(onKey.mock.calls[0]?.[0].key).toBe("ArrowRight");
  });
});

describe("ModelFrame (STL, OBJ, glTF)", () => {
  it("covers the canvas while loading and keeps it mounted", () => {
    render(
      <MessagesProvider locale="zh-CN">
        <ModelFrame cover={<p>loading cover</p>} details={<p>尺寸 10</p>} fileName="part.stl">
          <div data-testid="canvas" />
        </ModelFrame>
      </MessagesProvider>,
    );
    expect(screen.getByTestId("canvas")).toBeTruthy();
    expect(screen.getByText("loading cover")).toBeTruthy();
    expect(screen.getByText("尺寸 10")).toBeTruthy();
    expect(screen.getByText("拖动鼠标旋转 • 滚轮缩放 • 右键拖动平移")).toBeTruthy();
    expect(screen.getByTitle("全屏")).toBeTruthy();
  });

  it("goes fullscreen and offers to leave it", async () => {
    // jsdom has no Fullscreen API, which is what a browser that refuses looks like: the page is covered.
    const { container } = render(
      <ModelFrame fileName="part.stl">
        <div />
      </ModelFrame>,
    );
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.className).not.toContain("fixed");

    fireEvent.click(screen.getByTitle("Enter fullscreen"));
    fireEvent.click(await screen.findByTitle("Exit fullscreen"));
    expect(await screen.findByTitle("Enter fullscreen")).toBeTruthy();
    expect(frame.className).not.toContain("fixed");
  });
});

describe("AudioViewer", () => {
  it("shows the icon it is given, so a WeChat voice note plays in the same player", () => {
    render(<AudioViewer fileName="voice.silk" fileUrl="blob:voice" icon="🎙️" />);
    expect(screen.getByText("🎙️")).toBeTruthy();
    expect(document.querySelector("audio")?.getAttribute("src")).toBe("blob:voice");
  });
});
