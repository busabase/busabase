"use client";

import { Sparkles } from "lucide-react";
import { type ComponentType, useId } from "react";
import {
  MODEL_PROVIDER_LOGOS,
  type ModelProviderIconName,
  type ModelProviderLogoName,
} from "../model-provider-logos";

// Keep the Web renderer beside the platform-neutral artwork in the public workspace.

interface ModelProviderIconProps {
  className?: string;
}

function ProviderLogo({
  provider,
  className,
}: ModelProviderIconProps & { provider: ModelProviderLogoName }) {
  const id = useId().replace(/:/g, "");
  const logo = MODEL_PROVIDER_LOGOS[provider];

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={logo.viewBox}
      width="1em"
      height="1em"
      className={className}
      fill={logo.fill}
      fillRule={logo.fillRule}
    >
      <path d={logo.path} fill={logo.fill} />
      {logo.gradients?.map((gradient) => (
        <path key={gradient.name} d={logo.path} fill={`url(#${id}-${gradient.name})`} />
      ))}
      {logo.gradients && (
        <defs>
          {logo.gradients.map(({ name, stops, ...coordinates }) => (
            <linearGradient
              key={name}
              id={`${id}-${name}`}
              gradientUnits="userSpaceOnUse"
              {...coordinates}
            >
              {stops.map((stop) => (
                <stop key={stop.offset ?? "0"} {...stop} />
              ))}
            </linearGradient>
          ))}
        </defs>
      )}
    </svg>
  );
}

export const MODEL_ICON_COMPONENTS = {
  auto: ({ className }) => <Sparkles aria-hidden="true" focusable="false" className={className} />,
  anthropic: (props) => <ProviderLogo {...props} provider="anthropic" />,
  google: (props) => <ProviderLogo {...props} provider="google" />,
  openai: (props) => <ProviderLogo {...props} provider="openai" />,
  deepseek: (props) => <ProviderLogo {...props} provider="deepseek" />,
} satisfies Record<ModelProviderIconName, ComponentType<ModelProviderIconProps>>;
