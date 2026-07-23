import type { LucideIcon } from "lucide-react";

/**
 * The trigger button shared by a node's header actions (Permissions, Share, …).
 *
 * Every one of those is the same shape — an icon + label that opens a dialog —
 * and used to be copy-pasted verbatim per action, differing only in icon and
 * label. `variant` picks the rendering: `"toolbar"` is the bordered pill used in
 * node-detail headers; `"icon"` is the same pill but icon-only (square, for
 * tight toolbars); `"menu"` is a borderless full-width row for the sidebar
 * dropdown. The dialog itself stays owned by each caller (their bodies are
 * genuinely different); only this trigger is factored out.
 */
interface NodeActionButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  variant?: "toolbar" | "icon" | "menu";
}

export function NodeActionButton({
  icon: Icon,
  label,
  onClick,
  variant = "toolbar",
}: NodeActionButtonProps) {
  if (variant === "menu") {
    return (
      <button className="flex w-full items-center gap-2 text-left" onClick={onClick} type="button">
        <Icon className="size-4" />
        {label}
      </button>
    );
  }
  return (
    <button
      aria-label={label}
      className={
        variant === "icon"
          ? "inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground transition-colors hover:bg-accent"
          : "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-accent"
      }
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon className="size-3.5" />
      {variant === "toolbar" ? label : null}
    </button>
  );
}
