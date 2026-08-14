"use client";

import type { AgentCatalogEntryVO } from "busabase-contract/domains/agents/types";
import { Cloud, Monitor } from "lucide-react";

export function TransportBadge({ transport }: { transport: AgentCatalogEntryVO["transport"] }) {
  const local = transport === "local-subprocess";
  const Icon = local ? Monitor : Cloud;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
      <Icon className="size-3" />
      {local ? "Local" : "Remote"}
    </span>
  );
}
