import { groupConsecutiveToolCalls } from "@acp-ui/core/group";
import type {
  AcpBlock,
  AcpInputBlock,
  AcpInputResponse,
  AcpPermissionBlock,
} from "@acp-ui/core/reduce";
import { Fragment } from "react";
import { View } from "react-native";
import { spacing } from "~/theme/tokens";
import {
  AcpInputCard,
  AcpObservationCard,
  AcpResourceCard,
  type AcpResourceResolver,
} from "./AcpFidelityBlocks";
import { AcpMessageBlockView } from "./AcpMessageBlockView";
import { AcpNoteBanner } from "./AcpNoteBanner";
import { AcpPermissionCard } from "./AcpPermissionCard";
import { AcpToolCallRow } from "./AcpToolCallRow";
import { AcpToolRunRow } from "./AcpToolRunRow";

interface AcpTranscriptProps {
  blocks: readonly AcpBlock[];
  /** True while a turn is in flight — only the LAST block gets its live state. */
  streaming: boolean;
  onAnswerPermission: (block: AcpPermissionBlock, optionId: string) => void;
  onAnswerInput?: (block: AcpInputBlock, response: AcpInputResponse) => void;
  resolveResource?: AcpResourceResolver;
}

/**
 * The block list — mirrors `@acp-ui/web`'s `AcpTranscript`: same grouping
 * (`groupConsecutiveToolCalls` collapses 2+ consecutive tool calls into one
 * row, everything else renders inline), same rule for which block is "live"
 * (only the tail, and only while `streaming`).
 *
 * No scroll container of its own, matching web's own split between
 * `AcpTranscript` (the list) and `AcpConversation` (the scrolling shell) —
 * the chat screen owns scrolling here, because it also owns the
 * auto-scroll-to-latest behaviour a plain list does not need.
 */
export function AcpTranscript({
  blocks,
  streaming,
  onAnswerPermission,
  onAnswerInput,
  resolveResource,
}: AcpTranscriptProps) {
  const tail = blocks.length > 0 ? blocks[blocks.length - 1] : undefined;

  const renderSingle = (block: AcpBlock) => {
    const isTail = streaming && block === tail;
    switch (block.kind) {
      case "message":
        return <AcpMessageBlockView key={block.id} block={block} streaming={isTail} />;
      case "tool_call":
        return (
          <View key={block.id} style={styles.padded}>
            <AcpToolCallRow block={block} last />
          </View>
        );
      case "permission":
        return (
          <AcpPermissionCard
            key={block.id}
            block={block}
            onAnswer={(optionId) => onAnswerPermission(block, optionId)}
          />
        );
      case "note":
        return <AcpNoteBanner key={block.id} block={block} />;
      case "input_request":
        return (
          <AcpInputCard
            key={block.id}
            block={block}
            onAnswer={onAnswerInput ? (response) => onAnswerInput(block, response) : undefined}
          />
        );
      case "resource":
        return (
          <AcpResourceCard
            key={block.id}
            resource={block.resource}
            resolveResource={resolveResource}
          />
        );
      case "plan":
      case "step":
      case "turn":
      case "job":
        return <AcpObservationCard key={block.id} block={block} />;
      default: {
        // `AcpBlock` is a closed union — this is unreachable. The `never`
        // assignment turns a new block kind added to the core into a
        // compile error here, not a silently blank row.
        const unhandled: never = block;
        return unhandled;
      }
    }
  };

  return (
    <>
      {groupConsecutiveToolCalls(blocks).map((group) => (
        <Fragment
          key={group.kind === "run" ? group.blocks.map((b) => b.id).join(":") : group.block.id}
        >
          {group.kind === "run" ? (
            <View style={styles.padded}>
              <AcpToolRunRow blocks={group.blocks} />
            </View>
          ) : (
            renderSingle(group.block)
          )}
        </Fragment>
      ))}
    </>
  );
}

const styles = {
  padded: { paddingHorizontal: spacing[3] },
} as const;
