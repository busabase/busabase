import type {
  AcpAttachment,
  AcpMessageBlock,
  AcpNoteBlock,
  AcpPermissionBlock,
  AcpToolCallBlock,
} from "@acp-ui/core/reduce";
import type { ToolPart } from "kui/ai-elements/tool";
import type { ComponentType, ReactNode } from "react";
import type { AcpResourceLabels, AcpResourceResolver } from "./resource-view";
import type { AcpToolRunLabels } from "./tool-run-view";

export interface AcpReasoningLabels {
  thinking: string;
  brief: string;
  duration: (seconds: number) => string;
}

/**
 * The markdown renderer. Defaults to `kui`'s `Response` (Streamdown).
 *
 * Injectable because the *engine* is a binding concern, not a core one: buda
 * ships a heavily customised Streamdown with its own link/code/image overrides,
 * and a consumer that wants that look passes it here rather than forking this
 * package.
 */
export type AcpMarkdownComponent = ComponentType<{ children: string }>;

export interface AcpCitationLabels {
  sources: string;
  partial: string;
}

export interface AcpMessageViewProps {
  block: AcpMessageBlock;
  /** True while this block is the tail of a still-streaming turn. */
  streaming?: boolean;
  Markdown: AcpMarkdownComponent;
  reasoningLabel?: AcpReasoningLabels;
  citationLabels?: Partial<AcpCitationLabels>;
  resolveResource?: AcpResourceResolver;
  resourceLabels?: Partial<AcpResourceLabels>;
  /** Host-specific resource cards; undefined retains the default attachment view. */
  renderAttachment?: (attachment: AcpAttachment, index: number) => ReactNode | undefined;
}

export interface AcpToolCallViewProps {
  block: AcpToolCallBlock;
  outcomeLabels?: { cancelled?: string; interrupted?: string };
  resolveResource?: AcpResourceResolver;
  resourceLabels?: Partial<AcpResourceLabels>;
  statusLabels?: Partial<Record<ToolPart["state"], string>>;
}

export interface AcpToolRunViewProps {
  /** Two or more consecutive tool calls, collapsed into one row. */
  blocks: AcpToolCallBlock[];
  outcomeLabels?: { cancelled?: string; interrupted?: string };
  resolveResource?: AcpResourceResolver;
  resourceLabels?: Partial<AcpResourceLabels>;
  labels?: AcpToolRunLabels;
  statusLabels?: Partial<Record<ToolPart["state"], string>>;
}

export interface AcpPermissionViewProps {
  block: AcpPermissionBlock;
  onAnswer: (optionId: string) => void;
  answeredLabel?: string;
  cancelledLabel?: string;
  confirmationUnknownLabel?: string;
  retryLabel?: string;
  timeoutLabel?: (count: number) => string;
  timingOutLabel?: string;
}

export interface AcpNoteViewProps {
  block: AcpNoteBlock;
}

/**
 * Per-block renderer overrides.
 *
 * This is the headless half of the design: `@acp-ui/core` decides *what* the
 * conversation contains, and a host that needs a different look replaces one
 * renderer without reimplementing the reduction. Every slot is optional; the
 * defaults are the components in this package.
 */
export interface AcpTranscriptSlots {
  Message?: ComponentType<AcpMessageViewProps>;
  ToolCall?: ComponentType<AcpToolCallViewProps>;
  /** Renders a run of 2+ consecutive tool calls. A lone tool call uses `ToolCall` instead. */
  ToolRun?: ComponentType<AcpToolRunViewProps>;
  Permission?: ComponentType<AcpPermissionViewProps>;
  Note?: ComponentType<AcpNoteViewProps>;
  Markdown?: AcpMarkdownComponent;
  /** Shown when there are no blocks yet. */
  empty?: ReactNode;
}
