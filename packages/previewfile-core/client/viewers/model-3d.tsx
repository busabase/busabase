"use client";

// The 3D model viewer, kept out of `FileViewer` and every other entry point:
// it brings three.js and @react-three/fiber, whose global JSX.IntrinsicElements
// augmentation enters any program that compiles it — even through a lazy
// import — and breaks unrelated JSX types there (previewfile-core ships source,
// so hosts compile it). A host that wants 3D imports this subpath and passes it
// to `FileViewer` as `model3dViewer`; the others never see three or fiber.
//
// Hosts' TypeScript is not even shown this file: the package's `exports` map
// the subpath's `types` to `./model-3d-types.d.ts`, so their programs stay free
// of fiber. Only the bundler reads this module.

import dynamic from "next/dynamic";
import { I18n3dViewerLoading } from "./I18nLoadingState";
import type { Model3DViewer as Model3DViewerType } from "./model-3d-types";

export const Model3DViewer: typeof Model3DViewerType = dynamic(() => import("./Model3DViewer"), {
  ssr: false,
  loading: I18n3dViewerLoading,
});
