import type { ComponentType } from "react";
import type { ViewerProps } from "./viewer-props";

// What a host's TypeScript sees of `./model-3d` (see `exports` in package.json:
// its `types` condition points here, its `default` at the real module).
//
// The real module compiles the 3D viewer, and with it @react-three/fiber, whose
// global JSX.IntrinsicElements augmentation then enters the host's program and
// breaks unrelated JSX there: kui's `<Tag>` with `Tag: React.ElementType`
// stops accepting children. Hosts only need to hand this component to
// `FileViewer`, so they get its type and nothing else. `model-3d.tsx` is typed
// against this declaration, so the two cannot drift apart.
export declare const Model3DViewer: ComponentType<ViewerProps>;
