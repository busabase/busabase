"use client";

import { Button, type ButtonProps } from "kui/button";
import { cn } from "kui/utils";
import type { HTMLAttributes } from "react";

interface SegmentedControlProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "nav";
}

export const SegmentedControl = ({
  as: Component = "div",
  className,
  ...props
}: SegmentedControlProps) => (
  <Component className={cn("flex rounded-md bg-muted/60 p-0.5 text-xs", className)} {...props} />
);

interface SegmentedControlItemProps extends ButtonProps {
  selected: boolean;
}

export const SegmentedControlItem = ({
  selected,
  asChild,
  className,
  ...props
}: SegmentedControlItemProps) => (
  <Button
    variant="ghost"
    size="sm"
    asChild={asChild}
    type={asChild ? undefined : "button"}
    aria-pressed={asChild ? undefined : selected}
    className={cn(
      "h-7 rounded px-2.5 py-1.5 text-xs font-medium shadow-none",
      selected
        ? "bg-card text-foreground hover:bg-card"
        : "text-muted-foreground hover:bg-transparent hover:text-foreground",
      className,
    )}
    {...props}
  />
);
