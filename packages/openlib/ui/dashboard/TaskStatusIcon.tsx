"use client";

/**
 * Task Status Icon Component
 * Task status icon for consistent UI across apps.
 */

import { CheckCircle2, Circle, Clock, SquarePause, XCircle } from "lucide-react";
import type { NavItem } from "./types";

interface TaskStatusIconProps {
  status?: NavItem["status"];
  className?: string;
}

export function TaskStatusIcon({ status, className }: TaskStatusIconProps) {
  const baseClassName = className || "w-4 h-4";

  switch (status) {
    case "completed":
      return <CheckCircle2 className={`${baseClassName} text-success`} />;
    case "in_progress":
      return <Clock className={`${baseClassName} text-info`} />;
    case "waiting_for_input":
      return <SquarePause className={`${baseClassName} text-amber-500`} />;
    case "failed":
      return <XCircle className={`${baseClassName} text-error`} />;
    case "cancelled":
      return <XCircle className={`${baseClassName} text-muted-foreground`} />;
    default:
      return <Circle className={`${baseClassName} text-muted-foreground`} />;
  }
}
