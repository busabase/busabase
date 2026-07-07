import type { UserRefVO } from "busabase-contract/types";
import { Mail, Shield, UserRound, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { formatUserRefLabel, formatUserRefSubtitle } from "../helpers/format";

const initialsFor = (label: string) => {
  const clean = label.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!clean) {
    return "?";
  }
  const parts = clean.split(/\s+/);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : clean.slice(0, 2)).toUpperCase();
};

export function UserAvatar({
  className = "size-7",
  fallbackId,
  user,
}: {
  className?: string;
  fallbackId?: string | null;
  user?: UserRefVO | null;
}) {
  const messages = useCoreI18n();
  const label = formatUserRefLabel(user, fallbackId, messages);
  if (user?.image) {
    return (
      <img
        alt={label}
        className={`${className} shrink-0 rounded-full object-cover`}
        src={user.image}
      />
    );
  }
  return (
    <span
      className={`${className} inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-[11px] text-muted-foreground`}
    >
      {initialsFor(label)}
    </span>
  );
}

export function UserDetailDialog({
  fallbackId,
  onOpenChange,
  open,
  title,
  user,
}: {
  fallbackId?: string | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title?: string;
  user?: UserRefVO | null;
}) {
  const messages = useCoreI18n();
  const label = formatUserRefLabel(user, fallbackId, messages);
  const subtitle = formatUserRefSubtitle(user);
  const dialogTitle = title ?? messages.identity.memberDetail;

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
      <section className="w-full max-w-sm rounded-lg border bg-background p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-muted-foreground text-xs uppercase tracking-wide">
              {dialogTitle}
            </div>
            <div className="mt-2 flex min-w-0 items-center gap-3">
              <UserAvatar className="size-10" fallbackId={fallbackId} user={user} />
              <div className="min-w-0">
                <div className="truncate font-semibold text-base">{label}</div>
                {subtitle ? (
                  <div className="truncate text-muted-foreground text-sm">{subtitle}</div>
                ) : null}
              </div>
            </div>
          </div>
          <button
            aria-label={messages.identity.closeMemberDetail}
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-2.5 border-border/60 border-t pt-3 text-sm">
          {user?.email ? (
            <div className="flex min-w-0 items-center gap-2">
              <Mail className="shrink-0 text-muted-foreground" size={15} />
              <span className="truncate">{user.email}</span>
            </div>
          ) : null}
          {user?.role ? (
            <div className="flex min-w-0 items-center gap-2">
              <Shield className="shrink-0 text-muted-foreground" size={15} />
              <span className="truncate capitalize">{user.role}</span>
            </div>
          ) : null}
          <div className="flex min-w-0 items-start gap-2">
            <UserRound className="mt-0.5 shrink-0 text-muted-foreground" size={15} />
            <div className="min-w-0">
              <div className="text-muted-foreground text-xs">{messages.identity.userId}</div>
              <div className="break-all font-mono text-xs">
                {user?.id ?? fallbackId ?? messages.identity.unknownUser}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function UserRefButton({
  fallbackId,
  labelClassName = "font-medium",
  title,
  user,
}: {
  fallbackId?: string | null;
  labelClassName?: string;
  title?: string;
  user?: UserRefVO | null;
}) {
  const messages = useCoreI18n();
  const [open, setOpen] = useState(false);
  const label = useMemo(
    () => formatUserRefLabel(user, fallbackId, messages),
    [fallbackId, messages, user],
  );

  return (
    <>
      <button
        className={`min-w-0 truncate text-left transition-colors hover:text-foreground hover:underline ${labelClassName}`}
        onClick={() => setOpen(true)}
        title={label}
        type="button"
      >
        {label}
      </button>
      <UserDetailDialog
        fallbackId={fallbackId}
        onOpenChange={setOpen}
        open={open}
        title={title ?? messages.identity.memberDetail}
        user={user}
      />
    </>
  );
}
