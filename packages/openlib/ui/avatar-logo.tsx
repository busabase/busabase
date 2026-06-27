"use client";

import { Avatar, AvatarFallback, AvatarImage } from "kui/avatar";
import { Loader2, type LucideIcon, Pencil } from "lucide-react";

interface AvatarLogoProps {
  /** Current avatar/logo URL or icon component */
  src?: string | LucideIcon | null;
  /** Fallback content (text or icon) */
  fallback?: string | React.ReactNode;
  /** Alt text for image */
  alt?: string;
  /** Size variant */
  size?: "xxs" | "xs" | "sm" | "md" | "lg" | "xl";
  /** Show upload button overlay */
  editable?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Click handler for upload button */
  onUploadClick?: () => void;
  /** Additional CSS classes */
  className?: string;
}

const sizeClasses = {
  xxs: "h-6 w-6 text-[10px]",
  xs: "h-8 w-8 text-xs",
  sm: "h-12 w-12 text-sm",
  md: "h-16 w-16 text-base",
  lg: "h-24 w-24 text-lg",
  xl: "h-32 w-32 text-xl",
};

const iconSizes = {
  xxs: "h-3 w-3",
  xs: "h-3 w-3",
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
  xl: "h-8 w-8",
};

/**
 * Unified avatar/logo component
 *
 * Supports:
 * - Image URLs (string)
 * - Icon components (LucideIcon)
 * - Text fallback (first letter, initials)
 * - Icon fallback (custom icon component)
 * - Editable mode with camera button
 * - Loading state
 *
 * @example
 * // Display mode with image
 * <AvatarLogo src="https://..." fallback="U" alt="User" />
 *
 * // Display mode with icon
 * <AvatarLogo src={Building2} fallback="W" />
 *
 * // Editable mode
 * <AvatarLogo
 *   src={avatarUrl}
 *   fallback="U"
 *   editable
 *   onUploadClick={() => {}}
 * />
 */
export function AvatarLogo({
  src,
  fallback = "?",
  alt = "Avatar",
  size = "md",
  editable = false,
  loading = false,
  onUploadClick,
  className,
}: AvatarLogoProps) {
  // Determine if src is an icon component
  const isIconComponent = typeof src === "function";
  const isImageUrl = typeof src === "string" && (src.startsWith("http") || src.startsWith("/"));

  // Render icon component if provided
  const IconComponent = isIconComponent ? (src as LucideIcon) : null;

  // Extract initials from fallback string (max 2 letters)
  const displayFallback =
    typeof fallback === "string"
      ? fallback
          .split(" ")
          .map((n) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2)
      : fallback;

  return (
    <div className={`group relative inline-block ${className || ""}`}>
      <Avatar
        className={[
          sizeClasses[size],
          editable
            ? "border-4 border-border/30 shadow-sm transition-all duration-300 group-hover:ring-4 group-hover:ring-primary/20"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {isImageUrl ? (
          <AvatarImage src={src as string} alt={alt} />
        ) : IconComponent ? (
          <div className="flex items-center justify-center w-full h-full bg-primary/10 text-primary">
            <IconComponent className={iconSizes[size]} />
          </div>
        ) : null}
        <AvatarFallback className="font-semibold">{displayFallback}</AvatarFallback>
      </Avatar>

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-full">
          <Loader2 className={`${iconSizes[size]} animate-spin`} />
        </div>
      )}

      {/* Upload hover overlay */}
      {editable && !loading && (
        <button
          type="button"
          onClick={onUploadClick}
          className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          aria-label="Upload image"
        >
          <Pencil className={iconSizes[size]} color="white" />
        </button>
      )}
    </div>
  );
}
