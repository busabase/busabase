import { render } from "@testing-library/react";
import { createRef } from "react";
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelStage, type ModelView } from "./model-frame";

// No WebGL in jsdom: the stage renders its children, and the camera, controls,
// bounds and the renderer's light-making are stand-ins the test can read.
const camera = { position: new THREE.Vector3() };
const gl = {};
const scene: { environment: unknown } = { environment: null };
const lightTexture = { name: "studio light" };
const light = { texture: lightTexture, dispose: vi.fn() };
const generator = { fromScene: vi.fn(() => light), dispose: vi.fn() };
const room = { dispose: vi.fn() };
vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  // `new` needs a function, not an arrow.
  PMREMGenerator: vi.fn(function PMREMGenerator() {
    return generator;
  }),
}));
vi.mock("three/examples/jsm/environments/RoomEnvironment.js", () => ({
  RoomEnvironment: vi.fn(function RoomEnvironment() {
    return room;
  }),
}));
const controls = {
  target: new THREE.Vector3(),
  minDistance: 0,
  maxDistance: 120,
  update: vi.fn(),
};
// A 10-unit cube at the origin, which the stage fits the camera to 12 units away.
const bounds = {
  getSize: () => ({
    size: new THREE.Vector3(10, 10, 10),
    center: new THREE.Vector3(),
    distance: 12,
  }),
  refresh: vi.fn(() => bounds),
  moveTo: vi.fn(() => bounds),
  lookAt: vi.fn(() => bounds),
};

vi.mock("@react-three/fiber", () => ({
  useThree: (select: (state: unknown) => unknown) => select({ camera, controls, gl, scene }),
}));
vi.mock("@react-three/drei", () => ({
  OrbitControls: () => null,
  PerspectiveCamera: () => null,
  Stage: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useBounds: () => bounds,
}));

const movedTo = () => {
  const [position] = bounds.moveTo.mock.lastCall as unknown as [THREE.Vector3 | number[]];
  return Array.isArray(position) ? position : position.toArray();
};

beforeEach(() => {
  vi.clearAllMocks();
  camera.position.set(0, 0, 12);
  controls.minDistance = 0;
});

describe("ModelStage lighting", () => {
  it("lights the model from a studio it draws itself, with nothing to download", () => {
    const { unmount } = render(
      <ModelStage>
        <div />
      </ModelStage>,
    );
    expect(generator.fromScene).toHaveBeenCalledWith(room, 0.04);
    expect(scene.environment).toBe(lightTexture);

    unmount();
    expect(scene.environment).toBeNull();
    expect(light.dispose).toHaveBeenCalled();
    expect(generator.dispose).toHaveBeenCalled();
  });
});

describe("ModelStage", () => {
  it("keeps the camera outside the model and says when the model shows", () => {
    const onReady = vi.fn();
    render(
      <ModelStage onReady={onReady}>
        <div />
      </ModelStage>,
    );
    expect(controls.minDistance).toBeCloseTo(Math.sqrt(300) / 2);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("zooms in toward the model, stopping at its edge, and back out", () => {
    const view = createRef<ModelView>();
    render(
      <ModelStage viewRef={view}>
        <div />
      </ModelStage>,
    );

    view.current?.zoomIn();
    expect(bounds.refresh).toHaveBeenCalled();
    expect(movedTo()[2]).toBeCloseTo(9.6);

    camera.position.set(0, 0, 9);
    view.current?.zoomIn();
    expect(movedTo()[2]).toBeCloseTo(Math.sqrt(300) / 2);

    camera.position.set(0, 0, 12);
    view.current?.zoomOut();
    expect(movedTo()[2]).toBeCloseTo(15);
  });

  it("resets to the front view with the whole model in sight", () => {
    const view = createRef<ModelView>();
    render(
      <ModelStage viewRef={view}>
        <div />
      </ModelStage>,
    );
    camera.position.set(7, 3, -4);

    view.current?.reset();
    expect(movedTo()).toEqual([0, 0, 12]);
    expect(bounds.lookAt).toHaveBeenCalledWith({ target: new THREE.Vector3(), up: [0, 1, 0] });
  });
});
