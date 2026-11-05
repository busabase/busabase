import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toVideoCoverSrc } from "../helpers/cover-media";

/**
 * A video attachment drawn as a still cover — its first frame, muted, never
 * autoplaying — with a play badge so the card reads as a video, not a photo.
 *
 * The source is attached only once the card nears the viewport. Self-hosted
 * attachment routes answer without byte ranges, so every `<video>` that gets a
 * `src` may start streaming its file; a board with dozens of video cards must
 * not open dozens of downloads for cards nobody has scrolled to. Without
 * `IntersectionObserver` (old browsers, jsdom) it loads straight away.
 */
export function CoverVideo({
  className,
  fileName,
  onError,
  url,
}: {
  className: string;
  fileName: string;
  onError: () => void;
  url: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (isNearViewport) return;
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [isNearViewport]);

  return (
    <span className="relative block h-full w-full" data-cover-video>
      <video
        aria-label={fileName}
        className={className}
        disablePictureInPicture
        muted
        onError={onError}
        playsInline
        preload="metadata"
        ref={videoRef}
        src={isNearViewport ? toVideoCoverSrc(url) : undefined}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm">
          <Play className="translate-x-px fill-current" size={16} />
        </span>
      </span>
    </span>
  );
}
