"use client";

import type {
  AgentSessionConfigSelectVO,
  AgentSessionModelOptionVO,
} from "busabase-contract/domains/agents/types";
import { Button } from "kui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { Check, ChevronDown, Cpu } from "lucide-react";
import { useEffect, useState } from "react";
import { ModelProviderIcon } from "./model-provider-icons";

function ModelOptionLabel({ value, name }: { value: string; name: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <ModelProviderIcon value={value} name={name} className="size-4 shrink-0 text-foreground" />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Per-model capabilities come from the agent; hover only reveals those choices. */
export function ModelSelectorRow({
  modelOption,
  thinkingOption,
  thinkingLabel,
  disabled,
  error,
  onChange,
  onThinkingChange,
}: {
  modelOption: AgentSessionModelOptionVO | null;
  thinkingOption?: AgentSessionConfigSelectVO | null;
  thinkingLabel?: string;
  disabled: boolean;
  error?: string | null;
  onChange: (value: string, thinkingValue?: string) => void;
  onThinkingChange?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [submenuModel, setSubmenuModel] = useState<string | null>(null);
  const [requestedModel, setRequestedModel] = useState<string | null>(null);
  const hasThinking = Boolean(thinkingOption && onThinkingChange);
  const hasModelSubmenus = Boolean(
    modelOption?.options.some(
      (choice) => choice.thinking || (choice.value === modelOption.currentValue && hasThinking),
    ),
  );
  const label = thinkingLabel ?? thinkingOption?.name;
  const thinkingName =
    thinkingOption?.options.find((choice) => choice.value === thinkingOption.currentValue)?.name ??
    thinkingOption?.currentValue;
  const modelName =
    modelOption?.options.find((choice) => choice.value === modelOption.currentValue)?.name ??
    modelOption?.currentValue;

  // A model click keeps the menu open while ACP confirms both selectors.
  // Only that response can tell us whether the newly selected model has levels.
  useEffect(() => {
    if (!hasThinking) {
      setSubmenuModel((current) =>
        current === modelOption?.currentValue &&
        !modelOption.options.find((choice) => choice.value === current)?.thinking
          ? null
          : current,
      );
    }
    if (!open || disabled || !requestedModel) return;
    if (modelOption?.currentValue === requestedModel) {
      setRequestedModel(null);
      setSubmenuModel(hasThinking ? requestedModel : null);
      if (!hasThinking) setOpen(false);
    } else if (error) {
      setRequestedModel(null);
      setSubmenuModel(null);
      setOpen(false);
    }
  }, [disabled, error, hasThinking, modelOption, open, requestedModel]);

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setRequestedModel(null);
      setSubmenuModel(null);
    }
  };
  const changeThinking = (value: string) => {
    onThinkingChange?.(value);
    changeOpen(false);
  };

  return (
    <div className="flex min-w-0 items-center gap-1">
      <DropdownMenu open={open} onOpenChange={changeOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={modelOption?.name ?? label}
            disabled={disabled}
            className="h-8 min-w-0 max-w-56 gap-1 px-1.5 text-xs"
          >
            {modelOption ? (
              <ModelProviderIcon
                value={modelOption.currentValue}
                name={modelName ?? modelOption.name}
                className="size-3.5 shrink-0 text-foreground"
              />
            ) : (
              <Cpu className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{modelName || modelOption?.name || label}</span>
            {hasThinking && modelOption ? (
              <span className="shrink-0 text-muted-foreground">· {thinkingName}</span>
            ) : !modelOption && hasThinking ? (
              <span className="truncate text-muted-foreground">: {thinkingName}</span>
            ) : null}
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          // Leave room for the 8rem level menu and both viewport edges even
          // when neither side of a centered model menu could fit it otherwise.
          collisionPadding={hasModelSubmenus ? { left: 8, right: 136 } : 8}
          className={
            hasModelSubmenus ? "min-w-0 max-w-[min(18rem,calc(100vw-9rem))]" : "min-w-52 max-w-72"
          }
        >
          {modelOption ? (
            <DropdownMenuRadioGroup value={modelOption.currentValue}>
              {modelOption.options.map((choice) => {
                const isCurrent = choice.value === modelOption.currentValue;
                const thinking = (isCurrent ? thinkingOption : null) ?? choice.thinking;
                const levelName =
                  thinking?.options.find((level) => level.value === thinking.currentValue)?.name ??
                  thinking?.currentValue;
                const choiceLabel = thinkingLabel ?? thinking?.name;
                return thinking && (!isCurrent || onThinkingChange) ? (
                  <DropdownMenuSub
                    key={choice.value}
                    open={submenuModel === choice.value}
                    onOpenChange={(next) =>
                      setSubmenuModel((current) =>
                        next ? choice.value : current === choice.value ? null : current,
                      )
                    }
                  >
                    <DropdownMenuSubTrigger
                      disabled={disabled}
                      aria-label={`${choice.name}, ${choiceLabel}: ${levelName}`}
                      className="relative py-2 pl-8"
                      onClick={() => {
                        if (disabled || isCurrent) return;
                        setRequestedModel(choice.value);
                        onChange(choice.value);
                      }}
                    >
                      {isCurrent ? <Check className="absolute left-2 size-3.5" /> : null}
                      <span className="min-w-0">
                        <ModelOptionLabel {...choice} />
                        <span className="block text-xs text-muted-foreground">
                          {choiceLabel}: {levelName}
                        </span>
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent
                        aria-label={choiceLabel}
                        collisionPadding={8}
                        className="w-32 min-w-0"
                      >
                        <DropdownMenuRadioGroup
                          value={thinking.currentValue}
                          onValueChange={(value) => {
                            if (isCurrent && thinkingOption && onThinkingChange) {
                              changeThinking(value);
                            } else {
                              onChange(choice.value, value);
                              changeOpen(false);
                            }
                          }}
                        >
                          {thinking.options.map((level) => (
                            <DropdownMenuRadioItem
                              key={level.value}
                              value={level.value}
                              disabled={disabled}
                            >
                              <span className="truncate" title={level.name}>
                                {level.name}
                              </span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                ) : (
                  <DropdownMenuRadioItem
                    key={choice.value}
                    value={choice.value}
                    disabled={disabled}
                    onSelect={(event) => {
                      if (choice.value === modelOption.currentValue) return;
                      // Hover never changes the model. An explicit selection
                      // starts one request and keeps its confirmation menu open.
                      event.preventDefault();
                      setSubmenuModel(null);
                      setRequestedModel(choice.value);
                      onChange(choice.value);
                    }}
                  >
                    <ModelOptionLabel {...choice} />
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          ) : thinkingOption && onThinkingChange ? (
            <DropdownMenuRadioGroup
              aria-label={label}
              value={thinkingOption.currentValue}
              onValueChange={changeThinking}
            >
              {thinkingOption.options.map((level) => (
                <DropdownMenuRadioItem key={level.value} value={level.value} disabled={disabled}>
                  {level.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          ) : null}
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
