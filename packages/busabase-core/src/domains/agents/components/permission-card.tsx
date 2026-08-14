"use client";

import type { AgentPermissionRequestVO } from "busabase-contract/domains/agents/types";
import { Button } from "kui/button";
import { ShieldAlert } from "lucide-react";

interface PermissionCardProps {
  request: AgentPermissionRequestVO;
  /** Present once answered — renders the resolved state instead of the buttons. */
  resolvedOptionId?: string;
  onRespond: (optionId: string) => void;
  isResponding: boolean;
}

/**
 * ACP's `session/request_permission`, rendered as a decision the user makes
 * inline in the transcript — not a modal. A modal trains reflexive dismissal;
 * this way the conversation that led up to the request is still visible while
 * deciding. There is no "always allow" memory in this pass — every request
 * gets a real answer (see spec).
 */
export function PermissionCard({
  request,
  resolvedOptionId,
  onRespond,
  isResponding,
}: PermissionCardProps) {
  if (resolvedOptionId) {
    const chosen = request.options.find((o) => o.optionId === resolvedOptionId);
    const denied = chosen?.kind?.startsWith("reject");
    return (
      <div className="self-start rounded border border-dashed px-3 py-1.5 text-muted-foreground text-xs">
        {denied ? "Denied" : "Allowed"}
        {chosen ? `: ${chosen.name}` : ""}
        {request.title ? ` — ${request.title}` : ""}
      </div>
    );
  }

  return (
    <div className="flex max-w-md flex-col gap-2 self-start rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="flex items-center gap-2 font-medium text-sm">
        <ShieldAlert className="size-4 text-amber-600" />
        Wants to run a tool
      </div>
      {request.title ? <p className="text-sm">{request.title}</p> : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {request.options.map((option) => (
          <Button
            key={option.optionId}
            size="sm"
            variant={option.kind?.startsWith("reject") ? "outline" : "default"}
            disabled={isResponding}
            onClick={() => onRespond(option.optionId)}
          >
            {option.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
