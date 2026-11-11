/**
 * STLViewer - STL file viewer using Three.js STLLoader
 * Provides specialized STL file preview with automatic centering and scaling
 * Compatible with React 19 (replaced react-stl-viewer with native Three.js)
 */

"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { useI18n } from "../i18n";
import { useDownloadGuard } from "./download-guard";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { ModelFrame, ModelStage } from "./model-frame";
import { SceneErrorBoundary } from "./scene-error-boundary";

interface STLViewerProps {
  fileUrl: string;
  fileName: string;
  watermark?: string | null;
  noDownload?: boolean;
}

interface ModelDimensions {
  width: number;
  height: number;
  length: number;
}

interface STLModelProps {
  fileUrl: string;
  onLoad: (dimensions: ModelDimensions) => void;
  onError: (error: Error) => void;
}

/**
 * STL Model component that loads and renders the STL geometry
 */
function STLModel({ fileUrl, onLoad, onError }: STLModelProps) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [dimensions, setDimensions] = useState<ModelDimensions>({ width: 0, height: 0, length: 0 });
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    const loader = new STLLoader();

    loader.load(
      fileUrl,
      (loadedGeometry) => {
        // Dispose previous geometry if exists
        if (geometryRef.current) {
          geometryRef.current.dispose();
        }

        // Center the geometry
        loadedGeometry.center();

        // Compute bounding box for dimensions
        loadedGeometry.computeBoundingBox();
        const boundingBox = loadedGeometry.boundingBox;

        if (boundingBox) {
          setDimensions({
            width: boundingBox.max.x - boundingBox.min.x,
            height: boundingBox.max.y - boundingBox.min.y,
            length: boundingBox.max.z - boundingBox.min.z,
          });
        }

        geometryRef.current = loadedGeometry;
        setGeometry(loadedGeometry);
      },
      undefined, // onProgress - not used
      (error) => {
        onError(error instanceof Error ? error : new Error("Failed to load STL file"));
      },
    );

    return () => {
      if (geometryRef.current) {
        geometryRef.current.dispose();
        geometryRef.current = null;
      }
    };
  }, [fileUrl, onError]);

  const handleReady = useCallback(() => onLoad(dimensions), [onLoad, dimensions]);

  if (!geometry) return null;

  return (
    <ModelStage onReady={handleReady}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color="#888888" roughness={0.7} metalness={0.3} />
      </mesh>
    </ModelStage>
  );
}

export function STLViewer({ fileUrl, fileName, watermark, noDownload }: STLViewerProps) {
  const { LL } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [modelDimensions, setModelDimensions] = useState<ModelDimensions | null>(null);

  const handleLoad = useCallback((dimensions: ModelDimensions) => {
    setLoading(false);
    setError(null);
    setModelDimensions(dimensions);
  }, []);

  const handleError = useCallback((err: Error) => {
    setLoading(false);
    setError(err);
  }, []);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    setModelDimensions(null);
  }, []);

  // Disable right-click and download shortcuts
  useDownloadGuard(noDownload);

  if (error) {
    return (
      <ErrorState error={error} onRetry={handleRetry} title={LL.preview.stlLoadFailedTitle()} />
    );
  }

  return (
    <ModelFrame
      fileName={fileName}
      watermark={watermark}
      cover={loading && <LoadingState message={LL.preview.loadingStl()} />}
      details={
        modelDimensions && (
          <div className="text-xs text-gray-400 mt-1">
            {LL.preview.sizeLabel()} {modelDimensions.width.toFixed(1)} ×{" "}
            {modelDimensions.height.toFixed(1)} × {modelDimensions.length.toFixed(1)}
          </div>
        )
      }
    >
      <SceneErrorBoundary onError={handleError}>
        <Canvas className="w-full h-full" gl={{ antialias: true, alpha: false }} shadows>
          <Suspense fallback={null}>
            <STLModel fileUrl={fileUrl} onLoad={handleLoad} onError={handleError} />
          </Suspense>
        </Canvas>
      </SceneErrorBoundary>
    </ModelFrame>
  );
}
