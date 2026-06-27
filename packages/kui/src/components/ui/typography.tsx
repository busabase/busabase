import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils";

const typographyVariants = cva("", {
  variants: {
    variant: {
      h1: "scroll-m-20 text-5xl font-extrabold tracking-tight lg:text-5xl",
      h2: "scroll-m-20 text-4xl font-semibold tracking-tight",
      h3: "scroll-m-20 text-3xl font-semibold tracking-tight",
      h4: "scroll-m-20 text-2xl font-semibold tracking-tight",
      h5: "text-xl font-semibold",
      h6: "text-lg font-semibold",
      h7: "text-base font-semibold",
      h8: "text-xs font-semibold",
      p: "leading-7",
      b1: "text-lg leading-relaxed",
      b2: "text-base leading-relaxed",
      b3: "text-sm",
      b4: "text-xs",
      lead: "text-xl text-muted-foreground",
      large: "text-lg font-semibold",
      small: "text-sm font-medium leading-none",
      muted: "text-sm text-muted-foreground",
    },
  },
  defaultVariants: {
    variant: "p",
  },
});

type TypographyElement = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "div" | "label";

export interface TypographyProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof typographyVariants> {
  as?: TypographyElement;
  level?: VariantProps<typeof typographyVariants>["variant"]; // MUI Joy UI compatibility
}

function Typography({ className, variant, level, as, children, ...props }: TypographyProps) {
  // Support both 'variant' and 'level' for MUI compatibility
  const selectedVariant = level || variant;

  // Auto-select HTML tag based on variant/level
  const getTag = (): TypographyElement => {
    if (as) return as;

    const v = selectedVariant || "p";
    if (v === "lead" || v === "large" || v === "small" || v === "muted") return "p";
    // Only h1-h6 are valid HTML tags, h7/h8 should use span
    if (v.startsWith("h")) {
      const headingLevel = parseInt(v.slice(1), 10);
      if (headingLevel >= 1 && headingLevel <= 6) {
        return v as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      }
      return "span";
    }
    if (v.startsWith("b")) return "p";
    return "p";
  };

  const Tag = getTag() as React.ElementType;

  return (
    <Tag className={cn(typographyVariants({ variant: selectedVariant, className }))} {...props}>
      {children}
    </Tag>
  );
}

export { Typography, typographyVariants };
