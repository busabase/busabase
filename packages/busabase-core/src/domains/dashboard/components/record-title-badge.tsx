import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "kui/tooltip";
import { Star } from "lucide-react";
import { useCoreI18n } from "../../../i18n";

interface RecordTitleBadgeProps {
  testId?: string;
  tooltip: string;
}

export function RecordTitleBadge({ testId, tooltip }: RecordTitleBadgeProps) {
  const messages = useCoreI18n();

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={messages.base.recordTitle}
            className="inline-flex shrink-0 cursor-help items-center gap-1 rounded border border-primary/25 bg-primary/5 px-1.5 py-0.5 font-medium text-[10px] text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={testId}
            type="button"
          >
            <Star aria-hidden="true" className="size-3 fill-current" />
            {messages.base.recordTitle}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs" side="top">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
