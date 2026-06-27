"use client";

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { ChevronDown, ChevronUp } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";

interface CollapsibleItemProps extends React.ComponentProps<typeof CollapsiblePrimitive.Root> {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export function CollapsibleItem({
  title,
  description,
  children,
  className,
  defaultOpen = false,
  ...props
}: CollapsibleItemProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <CollapsiblePrimitive.Root
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn("mb-2 rounded-lg border border-border bg-card p-4 transition-all", className)}
      {...props}
    >
      <CollapsiblePrimitive.Trigger className="flex w-full cursor-pointer items-center justify-between gap-2">
        <div className="flex flex-col gap-1 text-left">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <div className="flex-shrink-0">
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </CollapsiblePrimitive.Trigger>

      <CollapsiblePrimitive.Content className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="mt-4 pt-4 border-t border-border">{children}</div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
