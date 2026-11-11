/**
 * Model3DViewer - 3D模型查看器
 * 支持格式: .obj, .stl, .gltf, .glb
 * 使用 Three.js + React Three Fiber (OBJ, GLTF, GLB)
 * 使用 react-stl-viewer (STL)
 */

"use client";

import { Canvas } from "@react-three/fiber";
import { AlertCircle, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { type Ref, Suspense, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { useI18n } from "../i18n";
import { useDownloadGuard } from "./download-guard";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { ModelFrame, ModelStage, type ModelView } from "./model-frame";
import { STLViewer } from "./STLViewer";
import { SceneErrorBoundary } from "./scene-error-boundary";
import { ViewerError } from "./viewer-error";
import type { ViewerProps as Model3DViewerProps } from "./viewer-props";

interface ModelProps {
  fileUrl: string;
  fileName: string;
  viewRef: Ref<ModelView>;
  /** Once the model shows. */
  onLoad: () => void;
  onError: (error: Error) => void;
  onProgress?: (progress: number) => void;
}

/**
 * 3D模型加载和渲染组件
 */
function Model({ fileUrl, fileName, viewRef, onLoad, onError, onProgress }: ModelProps) {
  const [model, setModel] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    const extension = fileName.split(".").pop()?.toLowerCase();
    let loader: GLTFLoader | OBJLoader;

    // An OBJ with no faces loads as an empty group: say so rather than show an empty stage.
    const show = (object: THREE.Object3D) => {
      if (new THREE.Box3().setFromObject(object).isEmpty())
        onError(new ViewerError("model3dEmpty"));
      else setModel(object);
    };

    // Progress handler
    const handleProgress = (progressEvent: ProgressEvent) => {
      if (progressEvent.lengthComputable && onProgress) {
        const percentComplete = (progressEvent.loaded / progressEvent.total) * 100;
        onProgress(Math.round(percentComplete));
      }
    };

    try {
      // 根据文件扩展名选择合适的加载器
      // Note: STL files are handled by STLViewer component, not here
      switch (extension) {
        case "gltf":
        case "glb":
          loader = new GLTFLoader();
          (loader as GLTFLoader).load(
            fileUrl,
            (gltf) => show(gltf.scene),
            handleProgress,
            (error) => onError(error as Error),
          );
          break;

        case "obj":
          loader = new OBJLoader();
          (loader as OBJLoader).load(
            fileUrl,
            (obj) => {
              // 为OBJ模型添加基础材质
              obj.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  child.material = new THREE.MeshStandardMaterial({
                    color: 0x888888,
                    roughness: 0.7,
                    metalness: 0.3,
                  });
                }
              });
              show(obj);
            },
            handleProgress,
            (error) => onError(error as Error),
          );
          break;

        default:
          onError(new Error(`Unsupported file format: ${extension}`));
      }
    } catch (err) {
      onError(err instanceof Error ? err : new Error("Failed to load 3D model"));
    }
  }, [fileUrl, fileName, onError, onProgress]);

  if (!model) return null;

  return (
    <ModelStage viewRef={viewRef} onReady={onLoad}>
      <primitive object={model} />
    </ModelStage>
  );
}

/**
 * Three.js-based viewer for OBJ, GLTF, GLB formats
 */
function ThreeJSViewer({ fileUrl, fileName, watermark, noDownload }: Model3DViewerProps) {
  const { LL } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const viewRef = useRef<ModelView>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [showSizeWarning, setShowSizeWarning] = useState(false);

  // Check file size on mount
  useEffect(() => {
    const checkFileSize = async () => {
      try {
        const response = await fetch(fileUrl, { method: "HEAD" });
        const sizeHeader = response.headers.get("content-length");
        if (sizeHeader) {
          const size = Number.parseInt(sizeHeader, 10);
          setFileSize(size);

          // Show warning for files > 10MB
          if (size > 10 * 1024 * 1024) {
            setShowSizeWarning(true);
          }
        }
      } catch (err) {
        console.warn("Failed to check file size:", err);
      }
    };

    checkFileSize();
  }, [fileUrl]);

  const handleLoad = useCallback(() => {
    setLoading(false);
    setError(null);
    setLoadingProgress(100);
    setShowSizeWarning(false);
  }, []);

  const handleError = useCallback((err: Error) => {
    setLoading(false);
    setError(err);
    setLoadingProgress(0);
  }, []);

  const handleProgress = useCallback((progress: number) => {
    setLoadingProgress(progress);
  }, []);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    // Canvas会重新渲染，触发模型重新加载
  }, []);

  // 禁用右键菜单和下载
  useDownloadGuard(noDownload);

  // Format file size helper
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (error) {
    return (
      <ErrorState error={error} onRetry={handleRetry} title={LL.preview.model3dLoadFailed()} />
    );
  }

  return (
    <ModelFrame
      fileName={fileName}
      watermark={watermark}
      controls={
        <>
          <button
            type="button"
            onClick={() => viewRef.current?.reset()}
            className="p-2 bg-white rounded-lg shadow hover:bg-gray-50 transition-colors"
            title={LL.preview.resetCamera()}
          >
            <RotateCcw className="w-5 h-5 text-gray-700" />
          </button>

          <button
            type="button"
            onClick={() => viewRef.current?.zoomIn()}
            className="p-2 bg-white rounded-lg shadow hover:bg-gray-50 transition-colors"
            title={LL.preview.zoomIn()}
          >
            <ZoomIn className="w-5 h-5 text-gray-700" />
          </button>

          <button
            type="button"
            onClick={() => viewRef.current?.zoomOut()}
            className="p-2 bg-white rounded-lg shadow hover:bg-gray-50 transition-colors"
            title={LL.preview.zoomOut()}
          >
            <ZoomOut className="w-5 h-5 text-gray-700" />
          </button>
        </>
      }
      cover={
        loading && (
          <>
            <LoadingState message={LL.preview.loading3dModel()} />
            {showSizeWarning && fileSize && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 p-4 bg-amber-50 border border-amber-200 rounded-lg max-w-md z-10">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-amber-900">{LL.preview.largeFileTitle()}</h4>
                    <p className="text-sm text-amber-700 mt-1">
                      {LL.preview.largeFileDesc({ size: formatFileSize(fileSize) })}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {loadingProgress > 0 && loadingProgress < 100 && (
              <div className="absolute bottom-24 left-1/2 w-64 -translate-x-1/2">
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${loadingProgress}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground text-center mt-2">
                  {LL.preview.loadedPercent({ percent: loadingProgress })}
                </p>
              </div>
            )}
          </>
        )
      }
    >
      <SceneErrorBoundary onError={handleError}>
        <Canvas className="w-full h-full" gl={{ antialias: true, alpha: false }} shadows>
          <Suspense fallback={null}>
            <Model
              fileUrl={fileUrl}
              fileName={fileName}
              viewRef={viewRef}
              onLoad={handleLoad}
              onError={handleError}
              onProgress={handleProgress}
            />
          </Suspense>
        </Canvas>
      </SceneErrorBoundary>
    </ModelFrame>
  );
}

export default function Model3DViewer({
  fileUrl,
  fileName,
  watermark,
  noDownload,
}: Model3DViewerProps) {
  // Check if this is an STL file - use dedicated STLViewer component
  const fileExtension = fileName.split(".").pop()?.toLowerCase();

  // Route to appropriate viewer based on file type
  if (fileExtension === "stl") {
    return (
      <STLViewer
        fileUrl={fileUrl}
        fileName={fileName}
        watermark={watermark}
        noDownload={noDownload}
      />
    );
  }

  // For other 3D formats (OBJ, GLTF, GLB), use Three.js implementation
  return (
    <ThreeJSViewer
      fileUrl={fileUrl}
      fileName={fileName}
      watermark={watermark}
      noDownload={noDownload}
    />
  );
}
