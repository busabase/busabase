/**
 * Unified error display component for file viewers
 * Provides user-friendly error messages with retry functionality
 */

import { AlertCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../i18n";
import { explainError } from "./explain-error";
import { useViewerRecovery } from "./viewer-recovery";

interface ErrorStateProps {
  error: string | Error;
  onRetry?: () => void;
  title?: string;
}

export function ErrorState({ error, onRetry, title }: ErrorStateProps) {
  const { LL } = useI18n();
  const [retrying, setRetrying] = useState(false);
  const retry = useViewerRecovery() ?? onRetry;

  const errorMessage = typeof error === "string" ? error : error.message;

  const handleRetry = async () => {
    if (!retry || retrying) return;

    setRetrying(true);
    try {
      await retry();
    } finally {
      // Keep retrying state for a moment to prevent double-clicks
      setTimeout(() => setRetrying(false), 1000);
    }
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-8">
      <div className="flex flex-col items-center gap-4 max-w-md text-center">
        <AlertCircle className="w-12 h-12 text-destructive" aria-hidden="true" />

        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-foreground">
            {title ?? LL.preview.failedToLoadFile()}
          </h3>
          <p className="text-sm text-muted-foreground">{explainError(LL.preview, error)}</p>
        </div>

        {retry && (
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${retrying ? "animate-spin" : ""}`} aria-hidden="true" />
            {retrying ? LL.preview.retrying() : LL.preview.tryAgain()}
          </button>
        )}

        <details className="mt-4 w-full text-left">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            {LL.preview.technicalDetails()}
          </summary>
          <pre className="mt-2 text-xs text-muted-foreground bg-muted p-3 rounded overflow-auto max-h-32">
            {errorMessage}
          </pre>
        </details>
      </div>
    </div>
  );
}
