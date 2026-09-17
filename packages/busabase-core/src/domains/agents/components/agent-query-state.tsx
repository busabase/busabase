"use client";

import { Button } from "kui/button";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { NodeDetailSkeleton } from "../../dashboard/components/skeletons";

export function AgentLoadingState() {
  return <NodeDetailSkeleton variant="folder" />;
}

export function AgentQueryErrorState({
  error,
  onRetry,
  title,
}: {
  error: unknown;
  onRetry: () => void;
  title: string;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center">
      <div className="max-w-sm">
        <h2 className="font-medium">{title}</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          {presentCoreError(messages, locale, error, messages.agents.queryFallbackError)}
        </p>
        <Button className="mt-3" onClick={onRetry} size="sm" type="button" variant="outline">
          {messages.agents.queryRetry}
        </Button>
      </div>
    </div>
  );
}
