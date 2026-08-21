"use client";

import { Alert, AlertDescription } from "kui/alert";
import type { AcpNoteViewProps } from "./slots";

/**
 * A session-level message — something the user must be told about the session
 * rather than about the conversation ("this agent has no workspace access",
 * "session ended — timeout"). `ended` notes are the terminal ones.
 */
export function AcpNoteView({ block }: AcpNoteViewProps) {
  return (
    <Alert
      variant={block.ended ? "destructive" : "default"}
      data-testid={block.ended ? "acp-note-ended" : "acp-note"}
    >
      <AlertDescription>{block.text}</AlertDescription>
    </Alert>
  );
}
