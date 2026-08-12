"use client";

import { motion } from "framer-motion";
import { cn } from "kui/utils";
import type { HTMLAttributes } from "react";

/**
 * A static placeholder
 * block with an animated gradient sweep, used in `skeletons.tsx` in place of
 * kui's flat `animate-pulse` `Skeleton` for the side-panel tab content
 * loading states (`NodeDetailSkeleton`, `FileContentSkeleton`,
 * `InboxListSkeleton`, `BaseTableSkeleton`). kui's `Skeleton` is left
 * untouched — this is a new component, not an edit to the protected package,
 * and `Skeleton` is still used as-is elsewhere in the app.
 */

interface ShimmerSkeletonProps extends HTMLAttributes<HTMLDivElement> {
  animated?: boolean;
}

export function ShimmerSkeleton({ animated = true, className, ...props }: ShimmerSkeletonProps) {
  return (
    <div className={cn("relative overflow-hidden rounded-md bg-muted", className)} {...props}>
      {animated && (
        <motion.div
          animate={{ x: "100%" }}
          className="absolute inset-0 z-10 bg-gradient-to-r from-transparent via-foreground/10 to-transparent"
          initial={{ x: "-100%" }}
          transition={{
            repeat: Number.POSITIVE_INFINITY,
            duration: 2.1,
            ease: "linear",
          }}
        />
      )}
    </div>
  );
}
