"use client";

import type { AgentSessionModelOptionVO } from "busabase-contract/domains/agents/types";
import {
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
} from "kui/ai-elements/prompt-input";
import { Cpu } from "lucide-react";

/**
 * "This agent lets you pick a model — here's the one it's using."
 *
 * Rendered via `AcpComposer`'s `footerControls` slot (stable ACP: the choices
 * come from the agent's `category: "model"` `session/new` config option, and
 * a change goes out over `session/set_config_option` — see
 * `agent-detail-view.tsx`), so it sits in the composer's own footer/tools row
 * next to the attach button, not as a separate row above it. Only passed
 * when the active session's `modelOption` is present: an agent that never
 * advertised a model option gets no control at all, rather than a picker with
 * one greyed-out choice.
 *
 * Kept in its own file, separate from `agent-detail-view.tsx`: that view pulls
 * in the whole ACP transcript/composer dependency graph, which a test for
 * this small, self-contained control has no reason to carry.
 *
 * Uses kui's `PromptInputSelect*` wrappers rather than the base `kui/select`:
 * they're already styled for this exact footer context (compact ghost trigger
 * with hover-accent) — the same wrappers a model-select-style tool button
 * would use elsewhere in `PromptInputFooter`.
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
    <div className="flex min-w-0 items-center gap-1">
      <PromptInputSelect
        // Radix participates in the nearest form's reset lifecycle. Remount
        // after an authoritative ACP value change so the form's reset baseline
        // follows that value instead of restoring the model from first mount.
        key={modelOption.currentValue}
        value={modelOption.currentValue}
        onValueChange={onChange}
        disabled={disabled}
      >
        <PromptInputSelectTrigger
          aria-label={modelOption.name}
          className="h-8 w-auto min-w-0 max-w-40 gap-1 px-1.5 text-xs"
        >
          <Cpu className="size-3.5 shrink-0 text-muted-foreground" />
          <PromptInputSelectValue placeholder={modelOption.name} />
        </PromptInputSelectTrigger>
        <PromptInputSelectContent>
          {modelOption.options.map((option) => (
            <PromptInputSelectItem key={option.value} value={option.value}>
              {option.name}
            </PromptInputSelectItem>
          ))}
        </PromptInputSelectContent>
      </PromptInputSelect>
      {error ? (
        <p className="truncate text-destructive" role="alert" title={error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
