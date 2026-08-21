"use client";

import type { AcpUsage } from "@acp-ui/core/reduce";

export interface AcpSessionMetaProps {
  /** The agent's own title for this conversation, from `session_info_update`. */
  title?: string | null;
  /** Token usage as of the most recent `usage_update`. */
  usage?: AcpUsage | null;
  className?: string;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
}

function formatCost(cost: NonNullable<AcpUsage["cost"]>): string {
  // Intl.NumberFormat over a hand-rolled `$${amount}` on purpose: `currency`
  // is whatever ISO 4217 code the agent reports (real Claude sessions send
  // "USD", but nothing in the protocol guarantees that), and formatting a
  // EUR/GBP/etc. amount as a bare `$` would misstate it.
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cost.currency }).format(
      cost.amount,
    );
  } catch {
    // An unrecognized ISO 4217 code (Intl throws on those) is still worth
    // showing something for, rather than hiding the cost entirely.
    return `${cost.amount} ${cost.currency}`;
  }
}

/**
 * Session-level facts neither prior ACP implementation surfaced at all:
 * `usage_update` and `session_info_update` were previously dropped along with
 * the 6 other unhandled `sessionUpdate` kinds. Deliberately small and easy to
 * ignore — this is metadata, not a feature either app asked for.
 *
 * Renders nothing until the agent has actually sent one of these (both
 * default to `null` on `AcpSessionState` until then), so a host can drop this
 * in unconditionally without an extra existence check.
 */
export function AcpSessionMeta({ title, usage, className }: AcpSessionMetaProps) {
  if (!title && !usage) return null;
  return (
    <p className={className} data-testid="acp-session-meta">
      {title && <span data-testid="acp-session-title">{title}</span>}
      {title && usage && " · "}
      {usage && (
        <span data-testid="acp-session-usage">
          {formatTokens(usage.used)} / {formatTokens(usage.size)} tokens
          {usage.cost && ` · ${formatCost(usage.cost)}`}
        </span>
      )}
    </p>
  );
}
