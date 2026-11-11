/// <reference path="../../types/ambient.d.ts" />
"use client";

import { AlertCircle, Download } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import { useI18n } from "../i18n";
import "video.js/dist/video-js.css";
import { LoadingState } from "./LoadingState";
import { videoJsLanguage } from "./video-languages";
import { useViewerLayout } from "./viewer-layout";

interface VideoViewerProps {
  fileUrl: string;
  /** The name a download is saved under (the URL's own may be a storage key). */
  fileName?: string;
  mimeType?: string;
  watermark?: string | null;
  noDownload?: boolean;
  /**
   * Convert MPEG and QuickTime/MOV to MP4 in the browser with ffmpeg.wasm
   * (default `true`). Its ~30 MB core is fetched from unpkg.com when a video is
   * opened, so a host that cannot depend on a third-party CDN turns this off:
   * the browser then tries the file as it is and, where it cannot play it,
   * shows the "format not supported" state.
   */
  transcode?: boolean;
  options?: Record<string, unknown>;
  className?: string;
  onReady?: (player: Player) => void;
  onError?: (error: MediaError) => void;
}

interface VideoJsOptions {
  controls?: boolean;
  responsive?: boolean;
  fluid?: boolean;
  fill?: boolean;
  preload?: string;
  playbackRates?: number[];
  controlBar?: VideoJsOptions;
  children?: string[];
  sources?: Array<{ src: string; type: string }>;
  [key: string]: unknown;
}

// Default Video.js options
const DEFAULT_VIDEOJS_OPTIONS: VideoJsOptions = {
  controls: true,
  responsive: true,
  fluid: false,
  fill: true,
  preload: "metadata",
  playbackRates: [0.5, 1, 1.5, 2],
};

export default function VideoViewer({
  fileUrl,
  fileName,
  mimeType: propMimeType,
  watermark,
  noDownload = false,
  transcode = true,
  options = {},
  className = "",
  onReady,
  onError,
}: VideoViewerProps) {
  const { LL, language } = useI18n();
  // The player is laid out `absolute inset-0` in this root, so the root must
  // have a height of its own. Standalone it is the flex child that takes the
  // page's remaining height; embedded in a host's frame there is no flex parent
  // to take it from, and the root collapses to nothing — a playing video nobody
  // can see — unless it fills the frame. (Spelled out for Tailwind's scanner.)
  const layout = useViewerLayout();
  const sizeClass = layout === "fill" ? "h-full" : "flex-1 min-h-0";
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [hasError, setHasError] = useState(false);
  // Why playback failed: transcoding, or the player with its own detail.
  // Worded at render time, in the viewer's language.
  const [playbackError, setPlaybackError] = useState<
    { kind: "transcode" } | { kind: "play"; detail: string } | null
  >(null);
  const [isTranscoding, setIsTranscoding] = useState(false);
  const [transcodingProgress, setTranscodingProgress] = useState(0);
  const [transcodedUrl, setTranscodedUrl] = useState<string | null>(null);
  const ffmpegRef = useRef<any>(null);
  const transcodingAttempted = useRef(false);

  // Check if the file needs client-side transcoding (MPEG or MOV / QuickTime)
  const mimeType = propMimeType || getMimeType(fileUrl);
  const isMpegFormat = mimeType === "video/mpeg";
  const isMovFormat = mimeType === "video/quicktime";
  const needsTranscode = transcode && (isMpegFormat || isMovFormat);

  // The actual URL to use for playback (transcoded or original)
  const playbackUrl = transcodedUrl || fileUrl;
  // A MOV that is not transcoded is played as it is: browsers report no
  // support for video/quicktime, which would make Video.js refuse the source
  // before trying it, although they play the H.264 inside. Called MP4, it is
  // sniffed and played where it can be.
  const playbackMimeType = transcodedUrl || isMovFormat ? "video/mp4" : mimeType;

  // Debug logging
  useEffect(() => {
    console.log("VideoViewer Debug:", {
      fileUrl,
      propMimeType,
      detectedMimeType: getMimeType(fileUrl),
      finalMimeType: mimeType,
      needsTranscode,
      transcodedUrl,
      playbackUrl,
    });
  }, [fileUrl, propMimeType, mimeType, needsTranscode, transcodedUrl, playbackUrl]);

  // Input/output filenames for FFmpeg virtual filesystem (MOV or MPEG)
  const inputFileName = isMovFormat ? "input.mov" : "input.mpeg";

  // Transcode MPEG or MOV to MP4 using FFmpeg.wasm
  const transcodeToMp4 = useCallback(async () => {
    if (transcodingAttempted.current) return;
    transcodingAttempted.current = true;

    setIsTranscoding(true);
    setTranscodingProgress(0);

    try {
      // Import FFmpeg modules
      const ffmpegModule = await import("@ffmpeg/ffmpeg");
      const utilModule = await import("@ffmpeg/util");

      const FFmpeg = ffmpegModule.FFmpeg;
      const toBlobURL = utilModule.toBlobURL;

      const ffmpeg = new FFmpeg();
      ffmpegRef.current = ffmpeg;

      // Set up progress handler
      ffmpeg.on("progress", ({ progress }) => {
        setTranscodingProgress(Math.round(progress * 100));
      });

      // Load FFmpeg with CORS-enabled URLs from unpkg CDN
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      });

      // Fetch the video file (MPEG or MOV)
      setTranscodingProgress(5);
      const response = await fetch(fileUrl);
      const fileData = await response.arrayBuffer();

      // Write input file to FFmpeg virtual filesystem
      setTranscodingProgress(10);
      await ffmpeg.writeFile(inputFileName, new Uint8Array(fileData));

      // Transcode to MP4 with H.264 codec
      setTranscodingProgress(15);
      await ffmpeg.exec([
        "-i",
        inputFileName,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "28",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "output.mp4",
      ]);

      // Read the output file
      setTranscodingProgress(95);
      const data = await ffmpeg.readFile("output.mp4");

      // Create blob URL for playback
      const uint8Data = new Uint8Array(data as Uint8Array);
      const blob = new Blob([uint8Data], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);

      setTranscodedUrl(url);
      setIsTranscoding(false);
      setTranscodingProgress(100);

      console.log("Video transcoding complete (MP4 URL):", url);
    } catch (err) {
      console.error("FFmpeg transcoding failed:", err);
      setIsTranscoding(false);
      setPlaybackError({ kind: "transcode" });
      setHasError(true);
    }
  }, [fileUrl, inputFileName]);

  // Start transcoding for MPEG or MOV files
  useEffect(() => {
    if (needsTranscode && !transcodedUrl && !isTranscoding && !hasError) {
      transcodeToMp4();
    }
  }, [needsTranscode, transcodedUrl, isTranscoding, hasError, transcodeToMp4]);

  // Initialize Video.js player
  useEffect(() => {
    // Don't initialize if we're transcoding or if format needs transcode but not done yet
    if (isTranscoding) return;
    if (needsTranscode && !transcodedUrl) return;

    // Ensure Video.js is only initialized once
    if (!playerRef.current && videoRef.current) {
      // Create video element
      const videoElement = document.createElement("video-js");
      videoElement.classList.add("vjs-big-play-centered");

      if (noDownload) {
        videoElement.setAttribute("controlsList", "nodownload");
      }

      videoRef.current.appendChild(videoElement);

      // Merge custom options with defaults
      const mergedOptions: VideoJsOptions = {
        ...DEFAULT_VIDEOJS_OPTIONS,
        language: videoJsLanguage(language),
        ...options,
        sources: [
          {
            src: playbackUrl,
            type: playbackMimeType,
          },
        ],
      };

      // Configure controlBar to exclude download button if noDownload is true
      if (noDownload) {
        mergedOptions.controlBar = {
          ...(typeof mergedOptions.controlBar === "object" ? mergedOptions.controlBar : {}),
          children: [
            "playToggle",
            "volumePanel",
            "currentTimeDisplay",
            "timeDivider",
            "durationDisplay",
            "progressControl",
            "remainingTimeDisplay",
            "playbackRateMenuButton",
            "fullscreenToggle",
          ],
        };
      }

      // Initialize Video.js player
      const player = videojs(videoElement, mergedOptions, () => {
        if (onReady) {
          onReady(player);
        }
      });

      // Set up error handler
      player.on("error", () => {
        const error = player.error();
        if (error) {
          console.error("Video.js error:", error);
          setPlaybackError({ kind: "play", detail: error.message || "" });
          setHasError(true);
          if (onError) {
            onError(error as MediaError);
          }
        }
      });

      playerRef.current = player;
    }

    // Cleanup function
    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [
    isTranscoding,
    needsTranscode,
    transcodedUrl,
    playbackUrl,
    playbackMimeType,
    noDownload,
    language,
    options,
    onReady,
    onError,
  ]);

  // Update player source when playbackUrl changes
  useEffect(() => {
    if (playerRef.current && playbackUrl && !isTranscoding) {
      const source = {
        src: playbackUrl,
        type: playbackMimeType,
      };
      playerRef.current.src(source);
    }
  }, [playbackUrl, playbackMimeType, isTranscoding]);

  // Cleanup transcoded URL on unmount
  useEffect(() => {
    return () => {
      if (transcodedUrl) {
        URL.revokeObjectURL(transcodedUrl);
      }
    };
  }, [transcodedUrl]);

  return (
    <div
      className={`w-full ${sizeClass} bg-muted flex flex-col items-center justify-center relative ${className}`}
    >
      {watermark && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-45deg] text-6xl font-bold text-white/20 select-none pointer-events-none whitespace-nowrap z-10">
          {watermark}
        </div>
      )}

      {/* Transcoding progress indicator */}
      {isTranscoding && (
        <LoadingState
          variant="converting"
          message={LL.preview.convertingVideo()}
          secondaryMessage={LL.preview.videoConvertMayTake()}
          progress={transcodingProgress}
          size="large"
        />
      )}

      {/* Transcoded success banner */}
      {transcodedUrl && !hasError && (
        <div className="w-full max-w-4xl mx-auto mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg flex items-start gap-3">
          <AlertCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-green-700">{LL.preview.videoConvertedTitle()}</p>
            <p className="text-green-600/90 mt-1">{LL.preview.videoConvertedDesc()}</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {hasError ? (
        <div className="w-full max-w-2xl mx-auto p-6 flex flex-col items-center justify-center gap-4 text-center">
          <AlertCircle size={64} className="text-yellow-500" />
          <h3 className="text-xl font-semibold">{LL.preview.videoUnsupportedTitle()}</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            {playbackError?.kind === "transcode"
              ? LL.preview.videoTranscodeFailed()
              : playbackError?.kind === "play"
                ? LL.preview.videoPlayFailed({
                    detail: playbackError.detail || LL.preview.unknownError(),
                  })
                : null}
          </p>
          {!noDownload && (
            <a
              href={fileUrl}
              download={fileName ?? true}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              <Download size={16} />
              {LL.preview.downloadVideoFile()}
            </a>
          )}
          <div className="mt-4 p-4 bg-muted rounded-lg text-left text-xs text-muted-foreground max-w-md">
            <p className="font-semibold mb-2">{LL.preview.videoWhyTitle()}</p>
            <p>{LL.preview.videoWhyDesc()}</p>
          </div>
        </div>
      ) : (
        !isTranscoding && <div ref={videoRef} className="absolute inset-0 w-full h-full" />
      )}
    </div>
  );
}

// Helper function to determine MIME type from file URL
function getMimeType(url: string): string {
  const cleanUrl = url.split("?")[0].split("#")[0];
  const extension = cleanUrl.split(".").pop()?.toLowerCase();

  const mimeTypes: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    webm: "video/webm",
    ogg: "video/ogg",
    ogv: "video/ogg",
    mov: "video/quicktime",
    qt: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
    mpe: "video/mpeg",
    m3u8: "application/x-mpegURL",
    mpd: "application/dash+xml",
  };

  return mimeTypes[extension || ""] || "video/mp4";
}
