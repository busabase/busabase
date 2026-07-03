"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCoreI18n } from "../../../i18n";

interface SplitSubmitButtonProps {
  /** Label for the main (default) action — e.g. "Create Change Request" */
  primaryLabel: string;
  /** Label for the alternative dropdown action — e.g. "Create & Merge" */
  secondaryLabel: string;
  primaryLoadingLabel?: string;
  secondaryLoadingLabel?: string;
  onPrimary: () => void;
  onSecondary: () => void;
  disabled?: boolean;
  isPrimaryLoading?: boolean;
  isSecondaryLoading?: boolean;
  /** Optional short hint shown at the top of the dropdown */
  hint?: string;
}

/**
 * Split-button combining a primary action with a dropdown alternative.
 * Default click = Change Request (safe review flow).
 * Chevron opens a dropdown revealing the direct-merge option.
 *
 *   [  Create Change Request  |  ↓  ]
 */
export function SplitSubmitButton({
  primaryLabel,
  secondaryLabel,
  primaryLoadingLabel = "Saving...",
  secondaryLoadingLabel = "Merging...",
  onPrimary,
  onSecondary,
  disabled = false,
  isPrimaryLoading = false,
  isSecondaryLoading = false,
  hint,
}: SplitSubmitButtonProps) {
  const messages = useCoreI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const isLoading = isPrimaryLoading || isSecondaryLoading;
  const isDisabled = disabled || isLoading;

  return (
    <div ref={ref} className="relative flex items-stretch">
      {/* Primary action */}
      <button
        className="rounded-l-md bg-foreground px-3 py-1.5 font-medium text-background text-xs transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isDisabled}
        onClick={onPrimary}
        type="button"
      >
        {isPrimaryLoading ? primaryLoadingLabel : primaryLabel}
      </button>

      {/* Separator */}
      <span className="w-px shrink-0 bg-background/20" />

      {/* Dropdown trigger */}
      <button
        aria-expanded={open}
        aria-label={messages.common.moreSubmitOptions}
        className="rounded-r-md bg-foreground px-2 py-1.5 text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isDisabled}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 bottom-full z-20 mb-1.5 min-w-max rounded-md border border-border/70 bg-popover py-1 shadow-lg">
          {hint && (
            <p className="border-border/50 border-b px-3 py-2 text-muted-foreground text-[11px] leading-relaxed">
              {hint}
            </p>
          )}
          <button
            className="w-full px-3 py-2 text-left text-foreground text-xs transition-colors hover:bg-accent"
            onClick={() => {
              setOpen(false);
              onSecondary();
            }}
            type="button"
          >
            {isSecondaryLoading ? secondaryLoadingLabel : secondaryLabel}
          </button>
        </div>
      )}
    </div>
  );
}
