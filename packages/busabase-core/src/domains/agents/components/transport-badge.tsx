"use client";

import type { AgentCatalogEntryVO } from "busabase-contract/domains/agents/types";
import { Cloud, Monitor } from "lucide-react";
import { useCoreI18n } from "../../../i18n";

export function TransportBadge({ transport }: { transport: AgentCatalogEntryVO["transport"] }) {
  const messages = useCoreI18n();
  const local = transport === "local-subprocess";
  const Icon = local ? Monitor : Cloud;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
      <Icon className="size-3" />
      {local ? messages.agents.local : messages.agents.remote}
    </span>
  );
}
