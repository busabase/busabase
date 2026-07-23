"use client";

import {
  type ApiKeyPermissionLevel,
  hasApiKeyLevel,
} from "busabase-contract/access-control/api-key-level";
import { ChevronDown } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { useCoreI18n } from "../../../i18n";

export type SubmitActionKind = "immediate" | "changeRequest";

export interface SubmitActionConfig {
  label: string;
  loadingLabel?: string;
  onSubmit: () => void;
  isLoading?: boolean;
}

const SubmitPermissionContext = createContext<ApiKeyPermissionLevel>("manage");

export function SubmitPermissionProvider({
  children,
  permissionLevel,
}: {
  children: ReactNode;
  permissionLevel: ApiKeyPermissionLevel;
}) {
  return (
    <SubmitPermissionContext.Provider value={permissionLevel}>
      {children}
    </SubmitPermissionContext.Provider>
  );
}

/** Pure ordering/visibility policy, exported for focused tests. */
export function resolveSubmitActionOrder(
  permissionLevel: ApiKeyPermissionLevel,
  defaultAction: SubmitActionKind = "immediate",
): SubmitActionKind[] {
  const allowed: SubmitActionKind[] = [];
  if (hasApiKeyLevel(permissionLevel, "write")) allowed.push("immediate");
  if (hasApiKeyLevel(permissionLevel, "changeRequest")) allowed.push("changeRequest");
  return allowed.includes(defaultAction)
    ? [defaultAction, ...allowed.filter((action) => action !== defaultAction)]
    : allowed;
}

interface SplitSubmitButtonProps {
  changeRequestAction: SubmitActionConfig;
  immediateAction: SubmitActionConfig;
  /** Main-button action. Defaults to immediate/auto-merge. */
  defaultAction?: SubmitActionKind;
  /** Overrides the nearest dashboard policy for standalone/sibling modals. */
  permissionLevel?: ApiKeyPermissionLevel;
  disabled?: boolean;
  /** Optional short hint shown at the top of the dropdown. */
  hint?: string;
  /** Open below when the button is placed in a top toolbar. */
  dropdownPosition?: "above" | "below";
}

/**
 * Permission-aware submit control. The main click defaults to the immediate
 * write/auto-merge action; the dropdown offers a reviewable Change Request.
 * Callers can reverse that order. A single allowed action renders as a normal
 * button, while read-only users get no submit action.
 */
export function SplitSubmitButton({
  changeRequestAction,
  immediateAction,
  defaultAction = "immediate",
  permissionLevel: permissionLevelOverride,
  disabled = false,
  hint,
  dropdownPosition = "above",
}: SplitSubmitButtonProps) {
  const messages = useCoreI18n();
  const inheritedPermissionLevel = useContext(SubmitPermissionContext);
  const permissionLevel = permissionLevelOverride ?? inheritedPermissionLevel;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const orderedKinds = resolveSubmitActionOrder(permissionLevel, defaultAction);
  const actions: Record<SubmitActionKind, SubmitActionConfig> = {
    changeRequest: changeRequestAction,
    immediate: immediateAction,
  };
  const primary = orderedKinds[0] ? actions[orderedKinds[0]] : null;
  const secondary = orderedKinds[1] ? actions[orderedKinds[1]] : null;
  if (!primary) return null;

  const isLoading = Boolean(primary.isLoading || secondary?.isLoading);
  const isDisabled = disabled || isLoading;
  const primaryLabel = primary.isLoading
    ? (primary.loadingLabel ?? messages.common.working)
    : primary.label;

  if (!secondary) {
    return (
      <button
        className="rounded-md bg-foreground px-3 py-1.5 font-medium text-background text-xs transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isDisabled}
        onClick={primary.onSubmit}
        type="button"
      >
        {primaryLabel}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative flex items-stretch">
      <button
        className="rounded-l-md bg-foreground px-3 py-1.5 font-medium text-background text-xs transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isDisabled}
        onClick={primary.onSubmit}
        type="button"
      >
        {primaryLabel}
      </button>

      <span className="w-px shrink-0 bg-background/20" />

      <button
        aria-expanded={open}
        aria-label={messages.common.moreSubmitOptions}
        className="rounded-r-md bg-foreground px-2 py-1.5 text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isDisabled}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open ? (
        <div
          className={`absolute right-0 z-20 min-w-max rounded-md border border-border/70 bg-popover py-1 shadow-lg ${
            dropdownPosition === "below" ? "top-full mt-1.5" : "bottom-full mb-1.5"
          }`}
        >
          {hint ? (
            <p className="border-border/50 border-b px-3 py-2 text-muted-foreground text-[11px] leading-relaxed">
              {hint}
            </p>
          ) : null}
          <button
            className="w-full px-3 py-2 text-left text-foreground text-xs transition-colors hover:bg-accent"
            onClick={() => {
              setOpen(false);
              secondary.onSubmit();
            }}
            type="button"
          >
            {secondary.isLoading
              ? (secondary.loadingLabel ?? messages.common.working)
              : secondary.label}
          </button>
        </div>
      ) : null}
    </div>
  );
}
