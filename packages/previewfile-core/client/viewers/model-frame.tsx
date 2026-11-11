"use client";

import { OrbitControls, PerspectiveCamera, Stage, useBounds } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Maximize2, Minimize2 } from "lucide-react";
import {
  type ComponentRef,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { PMREMGenerator } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useI18n } from "../i18n";
import { useFullscreen } from "./use-fullscreen";
import { useViewerLayout } from "./viewer-layout";

/** What the buttons over a 3D viewer do to its camera. */
export interface ModelView {
  zoomIn: () => void;
  zoomOut: () => void;
  /** Back to the front view with the whole model in sight. */
  reset: () => void;
}

const ZOOM_STEP = 0.8;

/**
 * Inside the stage, where the bounds the stage fit the camera to are known:
 * how close the camera may get, and the view the buttons drive.
 */
function ModelCamera({ viewRef, onReady }: Pick<ModelStageProps, "viewRef" | "onReady">) {
  const bounds = useBounds();
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as ComponentRef<typeof OrbitControls> | null;

  // The stage limits how far the camera may go by the model's size; limit how
  // close it may get the same way, so it stops at the model instead of inside it.
  useEffect(() => {
    if (!controls) return;
    const radius = bounds.getSize().size.length() / 2;
    if (Number.isFinite(radius) && radius > 0) {
      controls.minDistance = radius;
      controls.update();
    }
  }, [bounds, controls]);

  // Mounted means the stage has rendered: its environment map, which it
  // suspends for, has arrived.
  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useImperativeHandle(viewRef, () => {
    // `refresh` starts the camera's move from where it is now.
    const dolly = (factor: number) => {
      if (!controls) return;
      const offset = camera.position.clone().sub(controls.target);
      const distance = Math.min(
        Math.max(offset.length() * factor, controls.minDistance),
        controls.maxDistance,
      );
      bounds.refresh().moveTo(controls.target.clone().add(offset.setLength(distance)));
    };
    return {
      zoomIn: () => dolly(ZOOM_STEP),
      zoomOut: () => dolly(1 / ZOOM_STEP),
      reset: () => {
        const { center, distance } = bounds.refresh().getSize();
        bounds
          .moveTo([center.x, center.y, center.z + distance])
          .lookAt({ target: center, up: [0, 1, 0] });
      },
    };
  }, [bounds, camera, controls]);

  return null;
}

/** How much of the studio's light reaches the model (1 is the studio as built). */
const STUDIO_LIGHT_INTENSITY = 0.3;

/**
 * Soft studio light for the model, made here. drei's own `environment="city"`
 * downloads a photograph from a third-party host, and a viewer that cannot reach
 * it — offline, behind a firewall, a self-hosted deployment — would never show
 * the model, and its failure took the whole page down with it.
 */
function StudioLight() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    const generator = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const light = generator.fromScene(room, 0.04);
    scene.environment = light.texture;
    // A studio is a bright place: dimmed, the colours of the model stay its own.
    scene.environmentIntensity = STUDIO_LIGHT_INTENSITY;
    return () => {
      scene.environment = null;
      scene.environmentIntensity = 1;
      light.dispose();
      room.dispose();
      generator.dispose();
    };
  }, [gl, scene]);
  return null;
}

interface ModelStageProps {
  /** Where the viewer's buttons reach the camera. */
  viewRef?: Ref<ModelView>;
  /** Once the model shows: the viewer's loading cover can go. */
  onReady?: () => void;
  /** The loaded model. */
  children: ReactNode;
}

/**
 * The camera, orbit controls and lit stage the 3D viewers show a model on.
 * Mount it once the model has loaded: the stage centres the model, places its
 * lights and fits the camera to what it holds when it mounts, and an empty
 * stage would leave the camera wherever it started — inside a large model.
 */
export function ModelStage({ viewRef, onReady, children }: ModelStageProps) {
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 5]} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.05}
        enablePan
        enableZoom
        enableRotate
      />
      {/* The stage fits the camera to the model's middle; half again as far keeps a
          near face, like a cube's front, inside the view too. */}
      <StudioLight />
      <Stage environment={null} intensity={0.6} adjustCamera={1.5}>
        {children}
        <ModelCamera viewRef={viewRef} onReady={onReady} />
      </Stage>
    </>
  );
}

interface ModelFrameProps {
  fileName: string;
  watermark?: string | null;
  /** Buttons above the fullscreen one, e.g. Model3DViewer's camera controls. */
  controls?: ReactNode;
  /** Under the controls hint, e.g. the STL model's size. */
  details?: ReactNode;
  /** Covers the canvas while the model loads: the canvas has to stay mounted to load it. */
  cover?: ReactNode;
  /** The three.js canvas. */
  children: ReactNode;
}

/**
 * The frame around a 3D viewer's canvas: fullscreen, the watermark, the
 * file's name with the controls hint, and a cover while the model loads.
 */
export function ModelFrame({
  fileName,
  watermark,
  controls,
  details,
  cover,
  children,
}: ModelFrameProps) {
  const { LL } = useI18n();
  // Standalone, the model gets a fixed stage; embedded, the host's preview frame.
  const stage = useViewerLayout() === "fill" ? "h-full min-h-[320px]" : "h-[600px]";
  const frame = useRef<HTMLDivElement>(null);
  const { isFullscreen, overlay, toggle } = useFullscreen(frame);
  // Fullscreen the browser's way fills the screen by itself; the overlay is the fallback.
  const size = overlay ? "fixed inset-0 z-50" : isFullscreen ? "w-full h-full" : `w-full ${stage}`;
  return (
    <div className={`relative bg-gray-100 ${size}`} ref={frame}>
      {cover && <div className="absolute inset-0 z-20 bg-gray-100">{cover}</div>}

      {watermark && (
        <div className="absolute top-4 left-4 z-10 bg-black/10 text-white text-sm px-3 py-1 rounded pointer-events-none">
          {watermark}
        </div>
      )}

      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
        {controls}
        <button
          type="button"
          onClick={toggle}
          className="p-2 bg-white rounded-lg shadow hover:bg-gray-50 transition-colors"
          title={isFullscreen ? LL.preview.exitFullscreen() : LL.preview.enterFullscreen()}
        >
          {isFullscreen ? (
            <Minimize2 className="w-5 h-5 text-gray-700" />
          ) : (
            <Maximize2 className="w-5 h-5 text-gray-700" />
          )}
        </button>
      </div>

      <div className="absolute bottom-4 left-4 z-10 bg-white/90 backdrop-blur-sm px-3 py-2 rounded-lg shadow text-sm">
        <div className="font-medium text-gray-900">{fileName}</div>
        <div className="text-xs text-gray-500 mt-1">{LL.preview.model3dControlsHint()}</div>
        {details}
      </div>

      {children}
    </div>
  );
}
