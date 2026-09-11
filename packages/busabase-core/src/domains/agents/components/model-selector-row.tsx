"use client";

import type { AgentSessionModelOptionVO } from "busabase-contract/domains/agents/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "kui/select";
import { Cpu } from "lucide-react";

/**
 * "This agent lets you pick a model — here's the one it's using."
 *
 * Only mounted when the session's `modelOption` is present: an agent that
 * never advertised a `category: "model"` config option gets no row at all,
 * rather than a picker with one greyed-out choice. Sits in the same slot as
 * `AgentContextChip` in `agent-detail-view.tsx`, directly above the composer,
 * for the same reason — this is state about the *session*, not part of what
 * the composer itself (shared with acprouter) knows how to render.
 *
 * Kept in its own file, separate from `agent-detail-view.tsx`: that view pulls
 * in the whole ACP transcript/composer dependency graph, which a test for
 * this small, self-contained control has no reason to carry.
 */
export function ModelSelectorRow({
  modelOption,
  disabled,
  error,
  onChange,
}: {
  modelOption: AgentSessionModelOptionVO;
  disabled: boolean;
  error?: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <div className="shrink-0 border-t px-3 pt-2 text-xs">
      <div className="flex items-center gap-2">
        <Cpu className="size-3.5 shrink-0 text-muted-foreground" />
        <Select value={modelOption.currentValue} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger
            aria-label={modelOption.name}
            className="h-7 w-auto min-w-32 gap-1.5 border-0 bg-transparent px-1.5 text-xs shadow-none hover:bg-accent focus:ring-0 focus:ring-offset-0"
          >
            <SelectValue placeholder={modelOption.name} />
          </SelectTrigger>
          <SelectContent>
            {modelOption.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error ? (
        <p className="pl-5.5 text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
