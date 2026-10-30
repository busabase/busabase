"use client";

import { Cpu } from "lucide-react";
import type { ModelProviderIconName } from "openlib/model-provider-logos";
import { MODEL_ICON_COMPONENTS as SHARED_MODEL_ICON_COMPONENTS } from "openlib/ui/model-provider-icons";
import type { ComponentType } from "react";

type ModelProvider = ModelProviderIconName | "unknown";

interface ModelProviderIconProps {
  className?: string;
}

const MODEL_ICON_COMPONENTS = {
  ...SHARED_MODEL_ICON_COMPONENTS,
  unknown: ({ className }: ModelProviderIconProps) => (
    <Cpu aria-hidden="true" focusable="false" className={className} />
  ),
} satisfies Record<ModelProvider, ComponentType<ModelProviderIconProps>>;

const PROVIDER_PATTERNS = [
  {
    provider: "anthropic",
    value: /^(?:anthropic[/:])?claude(?:-|$)/i,
    name: /^claude(?:[\s-]|$)/i,
  },
  { provider: "google", value: /^(?:google[/:])?gemini(?:-|$)/i, name: /^gemini(?:[\s-]|$)/i },
  { provider: "openai", value: /^(?:openai[/:])?gpt(?:-|$)/i, name: /^gpt(?:[\s-]|$)/i },
  {
    provider: "deepseek",
    value: /^(?:deepseek[/:])?deepseek(?:-|$)/i,
    name: /^deepseek(?:[\s-]|$)/i,
  },
] as const;

function getModelProvider(value: string, name: string): ModelProvider {
  if (value.trim().toLowerCase() === "auto") return "auto";
  const byValue = PROVIDER_PATTERNS.find((entry) => entry.value.test(value.trim()));
  if (byValue) return byValue.provider;
  return PROVIDER_PATTERNS.find((entry) => entry.name.test(name.trim()))?.provider ?? "unknown";
}

/** Resolve ACP model labels locally without depending on any agent product catalog. */
export function ModelProviderIcon({
  value,
  name,
  className,
}: ModelProviderIconProps & { value: string; name: string }) {
  const Icon = MODEL_ICON_COMPONENTS[getModelProvider(value, name)];
  return <Icon className={className} />;
}
