import { Cable, KeyRound, UserRound } from "lucide-react";
import type { ReactNode } from "react";

const sameLabel = (left: string | null | undefined, right: string | null | undefined) =>
  Boolean(left && right && left.toLocaleLowerCase() === right.toLocaleLowerCase());

function AttributionValue({
  children,
  kind,
}: {
  children: ReactNode;
  kind: "channel" | "credential" | "owner";
}) {
  const Icon = kind === "owner" ? UserRound : kind === "credential" ? KeyRound : Cable;

  return (
    <span className="inline-flex min-w-0 items-center gap-1" data-attribution-kind={kind}>
      <Icon aria-hidden="true" className="size-3 shrink-0" strokeWidth={2} />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export function SourceAttributionInline({
  channelLabel,
  className = "",
  credentialLabel,
  leadingVia = false,
  owner,
  showChannel = true,
}: {
  channelLabel?: string | null;
  className?: string;
  credentialLabel?: string | null;
  leadingVia?: boolean;
  owner?: ReactNode;
  showChannel?: boolean;
}) {
  const sourceLabel = credentialLabel || channelLabel;
  const sourceKind = credentialLabel ? "credential" : "channel";
  const distinctChannel =
    showChannel && credentialLabel && channelLabel && !sameLabel(credentialLabel, channelLabel)
      ? channelLabel
      : null;

  return (
    <span
      className={`inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 ${className}`}
    >
      {owner ? <AttributionValue kind="owner">{owner}</AttributionValue> : null}
      {owner && sourceLabel ? <span aria-hidden="true">via</span> : null}
      {!owner && leadingVia && sourceLabel ? <span aria-hidden="true">via</span> : null}
      {sourceLabel ? <AttributionValue kind={sourceKind}>{sourceLabel}</AttributionValue> : null}
      {distinctChannel ? (
        <>
          <span aria-hidden="true">·</span>
          <AttributionValue kind="channel">{distinctChannel}</AttributionValue>
        </>
      ) : null}
    </span>
  );
}
