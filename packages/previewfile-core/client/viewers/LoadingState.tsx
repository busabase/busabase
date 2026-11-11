/**
 * Unified loading component for file viewers
 * Provides consistent loading experience across all viewer types
 */

import { LoaderCircle } from "lucide-react";
import { useI18n } from "../i18n";

/** Supported loading state variants */
export type LoadingVariant = "loading" | "converting" | "queued" | "checking";

/** Size variants for the spinner */
export type SpinnerSize = "default" | "large";

/** Props for the unified LoadingState component */
export interface LoadingStateProps {
  /** Primary message displayed below spinner */
  message?: string;
  /** Optional progress value (0-100) */
  progress?: number;
  /** Optional secondary message for additional context */
  secondaryMessage?: string;
  /** Optional file name being processed */
  fileName?: string;
  /** Size variant: 'default' (48px) or 'large' (64px) */
  size?: SpinnerSize;
  /** Loading state type for semantic styling */
  variant?: LoadingVariant;
}

export function LoadingState({
  message,
  progress: _progress,
  secondaryMessage: _secondaryMessage,
  fileName: _fileName,
  size = "default",
  variant = "loading",
}: LoadingStateProps) {
  const sizeClasses = size === "large" ? "w-10 h-10" : "w-8 h-8";
  const { LL } = useI18n();
  const variantMessages: Record<LoadingVariant, () => string> = {
    loading: LL.preview.loadingGeneric,
    converting: LL.preview.convertingGeneric,
    queued: LL.preview.queuedForConversion,
    checking: LL.preview.checkingDocument,
  };
  const displayMessage = message ?? variantMessages[variant]();

  return (
    <div
      className="w-full h-full min-h-[300px] flex flex-col items-center justify-center gap-4 bg-transparent"
      role="status"
      aria-live="polite"
    >
      <LoaderCircle className={`${sizeClasses} text-primary animate-spin`} aria-hidden="true" />

      <div className="text-center">
        <p className="text-sm text-muted-foreground">{displayMessage}</p>
      </div>
    </div>
  );
}

/**
 * Skeleton loader for content preview
 * Shows placeholder content while loading
 */
export function SkeletonLoader({ rows = 10 }: { rows?: number }) {
  return (
    <div className="w-full p-4 space-y-3 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          // biome-ignore lint: index is stable for skeleton rows
          key={i}
          className="h-4 bg-muted rounded"
          style={{ width: `${Math.random() * 30 + 70}%` }}
        />
      ))}
    </div>
  );
}
