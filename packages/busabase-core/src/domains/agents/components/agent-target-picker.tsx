"use client";

import { Bot } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AgentTarget } from "../utils/agent-targets";
import { TransportBadge } from "./transport-badge";

/**
 * "Send this to which agent?" — the list, and nothing else.
 *
 * Takes an already-normalized `AgentTarget[]` rather than querying the catalog
 * itself. That is what lets the later `@`-mention picker reuse it: mentions add
 * space *members* alongside agents and allow more than one selection, and both
 * of those are decisions about the list, not about how a row is drawn. A
 * component that fetched its own catalog would have to grow a mode flag for
 * every one of those differences.
 *
 * Deliberately not a Dialog: it renders inside the prompts dialog that is
 * already open, so stacking a second modal on top would put the prompt the user
 * just chose behind two layers of overlay.
 */
export function AgentTargetPicker({
  targets,
  onSelect,
  disabled = false,
  emptyLabel,
  label,
  autoFocus = false,
}: {
  targets: readonly AgentTarget[];
  onSelect: (target: AgentTarget) => void;
  /** True while a session is being created, so a double-click can't start two. */
  disabled?: boolean;
  emptyLabel: string;
  /** Names the list for assistive tech; the visible prompt above it is prose, not a label. */
  label?: string;
  /**
   * Focus the first target as soon as the list appears, so keyboard/screen-reader
   * users land inside the choice instead of having to hunt for it after the
   * catalog resolves mid-flow.
   */
  autoFocus?: boolean;
}) {
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocus) firstButtonRef.current?.focus();
  }, [autoFocus]);

  if (targets.length === 0) {
    return <p className="px-1 py-2 text-muted-foreground text-sm">{emptyLabel}</p>;
  }

  return (
    <div
      aria-label={label}
      className="flex max-h-[38vh] flex-col gap-1 overflow-y-auto"
      role="list"
    >
      {targets.map((target, index) => (
        // A `<button role="listitem">` would strip its own button semantics from
        // the accessibility tree (role="listitem" replaces, not adds to, the
        // implicit role) — screen readers would announce it as a plain list
        // item, not something actionable. Keeping `listitem` on this wrapper and
        // leaving the button itself unadorned preserves both.
        <div key={target.slug} role="listitem">
          <button
            className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
            disabled={disabled}
            onClick={() => onSelect(target)}
            ref={index === 0 ? firstButtonRef : undefined}
            type="button"
          >
            <Bot aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {target.name}
              {target.connectorName ? (
                <span className="ml-2 text-muted-foreground text-xs">{target.connectorName}</span>
              ) : null}
            </span>
            <TransportBadge transport={target.transport} />
          </button>
        </div>
      ))}
    </div>
  );
}
