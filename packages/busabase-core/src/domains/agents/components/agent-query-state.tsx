import { Button } from "kui/button";
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
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center">
      <div className="max-w-sm">
        <h2 className="font-medium">{title}</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          {error instanceof Error ? error.message : "Please try again."}
        </p>
        <Button className="mt-3" onClick={onRetry} size="sm" type="button" variant="outline">
          Retry
        </Button>
      </div>
    </div>
  );
}
