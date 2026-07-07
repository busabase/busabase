import { ArrowLeft, Check, ChevronRight, PenLine, X } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import type { ReactNode } from "react";
import { useCoreI18n } from "../../../i18n";
import { changeRequestStatusLabel, statusTone } from "../helpers/change-request";

export function CheckboxBadge({ checked }: { checked: boolean }) {
  const messages = useCoreI18n();

  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-xs ${
        checked
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "border-border bg-muted/40 text-muted-foreground"
      }`}
    >
      {checked ? <Check size={12} /> : <X size={12} />}
      {checked ? messages.common.yes : messages.common.no}
    </span>
  );
}

// Controlled: the open state + toggle live in the detail header (shared by the
// record and change-request detail views), so collapsing also widens the main
// column via the `[1fr auto]` grid.
export function BusabaseSidePanel({ children, open }: { children: ReactNode; open: boolean }) {
  return (
    <aside
      className={`min-w-0 space-y-3 transition-[width] duration-200 lg:sticky lg:top-4 lg:self-start ${
        open ? "w-full lg:w-72 xl:w-80" : "w-full lg:w-12"
      }`}
    >
      {open ? (
        <div className="min-w-0 space-y-3">{children}</div>
      ) : (
        <div className="hidden flex-col items-center gap-2 pt-1 lg:flex">
          <span className="size-2 rounded-full bg-muted-foreground/40" />
          <span className="size-2 rounded-full bg-muted-foreground/25" />
          <span className="size-2 rounded-full bg-muted-foreground/25" />
        </div>
      )}
    </aside>
  );
}

// Shared rail collapse/expand toggle, placed in the detail header (xl only).
export function RailToggleButton({ onToggle, open }: { onToggle: () => void; open: boolean }) {
  const messages = useCoreI18n();
  const label = open ? messages.common.close : messages.common.open;

  return (
    <button
      aria-label={label}
      className="hidden size-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground xl:flex"
      onClick={onToggle}
      title={label}
      type="button"
    >
      <ChevronRight className={open ? "" : "rotate-180"} size={15} />
    </button>
  );
}

// `quiet` renders a low-chrome, Linear-style rail section: no card box, an
// uppercase muted label, and a top divider between sections (used by the record
// detail rail). The default boxed style is kept for other panels (CR / schema).
export function SidebarPanel({
  action,
  children,
  quiet = false,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  quiet?: boolean;
  title: string;
}) {
  return (
    <section
      className={
        quiet
          ? "min-w-0 border-border/60 border-t pt-4"
          : "min-w-0 rounded-lg border border-border/60 bg-background/70 p-4 shadow-sm shadow-black/[0.025]"
      }
    >
      <div className={`flex items-center justify-between gap-3 ${quiet ? "mb-3" : "mb-4"}`}>
        <div
          className={
            quiet
              ? "font-medium text-muted-foreground text-xs uppercase tracking-wide"
              : "inline-flex items-center gap-1.5 font-medium text-muted-foreground text-sm"
          }
        >
          {title}
          {quiet ? null : <ChevronRight className="rotate-90" size={13} />}
        </div>
        {action ?? null}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export function SidebarRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[124px_minmax(0,1fr)] items-center gap-3 text-sm">
      <div className="truncate text-muted-foreground">{label}</div>
      <div className="min-w-0 truncate text-muted-foreground text-xs">{value}</div>
    </div>
  );
}

export function ConfirmActionDialog({
  body,
  confirmLabel,
  destructive = true,
  onCancel,
  onConfirm,
  open,
  pending,
  title,
}: {
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  pending?: boolean;
  title: string;
}) {
  const messages = useCoreI18n();

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
      <section className="w-full max-w-sm rounded-lg border bg-background p-4 shadow-xl">
        <div className="font-semibold text-base">{title}</div>
        <p className="mt-2 text-muted-foreground text-sm leading-6">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-md border border-border/70 bg-background px-3 py-1.5 font-medium text-sm transition-colors hover:bg-accent"
            disabled={pending}
            onClick={onCancel}
            type="button"
          >
            {messages.common.cancel}
          </button>
          <button
            className={`rounded-md px-3 py-1.5 font-medium text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              destructive
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-foreground text-background hover:bg-foreground/85"
            }`}
            disabled={pending}
            onClick={onConfirm}
            type="button"
          >
            {pending ? messages.common.working : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      className="inline-flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
      href={href}
    >
      <ArrowLeft size={14} />
      {label}
    </Link>
  );
}

export function PropertyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-0.5 break-all font-mono text-xs">{value}</div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const messages = useCoreI18n();

  return (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-1 font-medium text-xs ${statusTone(status)}`}
    >
      {changeRequestStatusLabel(status, messages)}
    </span>
  );
}

export function EmptyState({
  action,
  body,
  title,
}: {
  action?: ReactNode;
  body: string;
  title: string;
}) {
  return (
    <div className="grid min-h-[460px] place-items-center p-10 text-center">
      <div>
        <div className="mx-auto grid size-14 place-items-center rounded-xl border bg-background">
          <PenLine size={24} />
        </div>
        <h2 className="mt-4 font-semibold text-2xl">{title}</h2>
        <p className="mt-2 text-muted-foreground">{body}</p>
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </div>
  );
}
