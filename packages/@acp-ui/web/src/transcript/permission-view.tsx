"use client";

import { Alert, AlertDescription, AlertTitle } from "kui/alert";
import { Button } from "kui/button";
import { useEffect, useState } from "react";
import type { AcpPermissionViewProps } from "./slots";

/**
 * A live countdown, not a static timestamp — the user needs to see the window
 * closing. Ticks only while this specific card is still unanswered, and only
 * when the host set a deadline at all.
 */
function useCountdown(timeoutAt: string | undefined, active: boolean): number | null {
  const [remainingMs, setRemainingMs] = useState<number | null>(() =>
    timeoutAt ? new Date(timeoutAt).getTime() - Date.now() : null,
  );

  useEffect(() => {
    if (!timeoutAt || !active) return;
    setRemainingMs(new Date(timeoutAt).getTime() - Date.now());
    const interval = setInterval(() => {
      setRemainingMs(new Date(timeoutAt).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [timeoutAt, active]);

  return timeoutAt ? remainingMs : null;
}

/**
 * The permission card — and the reason this whole stack does not route through
 * the AI SDK.
 *
 * ACP's `session/request_permission` carries a *list* of options ("allow once",
 * "always allow", "reject"…). The AI SDK's approval state is a boolean, and
 * kui's `<Confirmation>` renders that boolean; neither can express the choice
 * the agent is actually asking for. So this is the one block type that does not
 * reuse an `ai-elements` component, and it is built from plain `kui` primitives
 * instead.
 *
 * Nothing here ever answers on the user's behalf. busabase blocks indefinitely
 * and deliberately never auto-approves — that is a security property, so the
 * timeout hint is rendered only when the host supplied a deadline.
 */
export function AcpPermissionView({ block, onAnswer }: AcpPermissionViewProps) {
  const { resolution } = block;
  const answered = typeof resolution === "object";
  const remainingMs = useCountdown(block.timeoutAt, resolution === "pending");

  return (
    <Alert data-testid="acp-permission">
      <AlertTitle>{block.title}</AlertTitle>
      {answered ? (
        <AlertDescription data-testid="acp-permission-answer">
          Answered:{" "}
          {block.options.find((o) => o.optionId === resolution.optionId)?.name ??
            resolution.optionId}
        </AlertDescription>
      ) : (
        <AlertDescription className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {block.options.map((option) => (
              <Button
                key={option.optionId}
                size="sm"
                variant={option.kind?.startsWith("reject") ? "destructive" : "default"}
                // Disabled while the answer is in flight so a second click
                // cannot race the first.
                disabled={resolution === "answering"}
                onClick={() => onAnswer(option.optionId)}
              >
                {option.name}
              </Button>
            ))}
          </div>
          {remainingMs !== null && (
            <span className="text-muted-foreground text-xs" data-testid="acp-permission-countdown">
              {remainingMs > 0
                ? `Times out in ${Math.ceil(remainingMs / 1000)}s if left unanswered.`
                : "Timing out…"}
            </span>
          )}
        </AlertDescription>
      )}
    </Alert>
  );
}
