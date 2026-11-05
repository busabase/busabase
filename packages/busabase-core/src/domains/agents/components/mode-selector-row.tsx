"use client";

import type { AgentSessionModeOptionVO } from "busabase-contract/domains/agents/types";
import { Button } from "kui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { ChevronDown, Shield } from "lucide-react";

/** Show the agent's actual mode names; modes are not universally permission policies. */
export function ModeSelectorRow({
  modeOption,
  modeLabel,
  disabled,
  error,
  onChange,
}: {
  modeOption: AgentSessionModeOptionVO;
  modeLabel: string;
  disabled: boolean;
  error?: string | null;
  onChange: (value: string) => void;
}) {
  const label = modeOption.source === "legacy" ? modeLabel : modeOption.name;
  const selected = modeOption.options.find((option) => option.value === modeOption.currentValue);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={label}
            title={selected?.description ?? modeOption.description}
            disabled={disabled}
            className="h-8 min-w-0 max-w-48 gap-1 px-1.5 text-xs"
          >
            <Shield className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{selected?.name ?? modeOption.currentValue}</span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="min-w-48 max-w-80">
          <DropdownMenuRadioGroup
            value={modeOption.currentValue}
            onValueChange={(value) => {
              if (!disabled && value !== modeOption.currentValue) onChange(value);
            }}
          >
            {modeOption.options.map((option) => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                aria-label={option.name}
                disabled={disabled}
              >
                <span className="min-w-0">
                  <span className="block">{option.name}</span>
                  {option.description ? (
                    <span className="block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <p className="truncate text-destructive" role="alert" title={error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
