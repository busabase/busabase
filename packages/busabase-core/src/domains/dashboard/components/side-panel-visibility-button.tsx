"use client";

import { cn } from "kui/utils";
import { PanelRight } from "lucide-react";
import { type ComponentPropsWithoutRef, forwardRef } from "react";
import { useCoreI18n } from "../../../i18n";

interface SidePanelVisibilityButtonProps extends ComponentPropsWithoutRef<"button"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SidePanelVisibilityButton = forwardRef<
  HTMLButtonElement,
  SidePanelVisibilityButtonProps
>(({ open, onOpenChange, className, ...props }, ref) => {
  const messages = useCoreI18n();
  const label = open ? messages.sidePanel.collapse : messages.sidePanel.open;

  return (
    <button
      aria-expanded={open}
      aria-label={label}
      aria-pressed={open}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground",
        className,
      )}
      onClick={() => onOpenChange(!open)}
      ref={ref}
      title={label}
      type="button"
      {...props}
    >
      <PanelRight aria-hidden className="size-4" />
    </button>
  );
});

SidePanelVisibilityButton.displayName = "SidePanelVisibilityButton";
