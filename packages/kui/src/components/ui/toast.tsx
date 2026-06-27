"use client";

import { toast as sonnerToast } from "sonner";

export interface SnackbarShowProps {
  content: string;
  variant?: "default" | "solid";
  color?: "primary" | "success" | "warning" | "danger" | "neutral";
  duration?: number;
}

/**
 * Show a toast notification using sonner
 * Compatible with existing `snackbarShow` usage
 */
export const snackbarShow = ({
  content,
  color = "neutral",
  duration = 3000,
}: SnackbarShowProps) => {
  switch (color) {
    case "success":
      sonnerToast.success(content, { duration });
      break;
    case "danger":
      sonnerToast.error(content, { duration });
      break;
    case "warning":
      sonnerToast.warning(content, { duration });
      break;
    case "primary":
      sonnerToast.info(content, { duration });
      break;
    default:
      sonnerToast(content, { duration });
      break;
  }
};

// Re-export sonner's `toast` for direct usage when needed
export { toast } from "sonner";
