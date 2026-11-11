import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessagesProvider } from "../i18n";
import Model3DViewer from "./Model3DViewer";

// WebGL is not available in jsdom: a stand-in canvas that only records it was mounted.
vi.mock("@react-three/fiber", () => ({
  Canvas: () => <div data-testid="three-canvas" />,
}));
vi.mock("@react-three/drei", () => ({
  OrbitControls: () => null,
  PerspectiveCamera: () => null,
  Stage: () => null,
}));

describe("Model3DViewer (OBJ, glTF)", () => {
  it("mounts the canvas while the model loads, under a loading cover", () => {
    // The canvas is what loads the model: with it missing the viewer never finished loading.
    render(<Model3DViewer fileName="part.obj" fileUrl="/part.obj" />);
    expect(screen.getByTestId("three-canvas")).toBeTruthy();
    expect(screen.getByText("Loading 3D model...")).toBeTruthy();
  });

  it("says so in the host's language", () => {
    render(
      <MessagesProvider locale="ja">
        <Model3DViewer fileName="part.glb" fileUrl="/part.glb" />
      </MessagesProvider>,
    );
    expect(screen.getByTestId("three-canvas")).toBeTruthy();
    expect(screen.getByText("3D モデルを読み込み中...")).toBeTruthy();
    expect(screen.getByTitle("全画面表示")).toBeTruthy();
    expect(screen.getByText("ドラッグで回転 • スクロールでズーム • 右クリックで移動")).toBeTruthy();
  });
});
