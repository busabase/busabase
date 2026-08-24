import type * as acp from "@agentclientprotocol/sdk";
import type { AcpAttachment } from "../reduce";

/**
 * Text + staged attachments → ACP's `PromptRequest.prompt` content-block
 * array. Was duplicated verbatim in both acprouter's and busabase's `logic/`
 * (same body, byte-for-byte) since each app's `PromptAttachmentInput` DTO is
 * already `AcpAttachment`'s shape (`{ kind: "image"|"audio", data, mimeType }`
 * — ACP's own `ImageContent`/`AudioContent` shape verbatim), so there was
 * nothing app-specific left to justify two copies.
 */
export function buildPromptContent(
  text: string,
  attachments: AcpAttachment[] | undefined,
): acp.ContentBlock[] {
  return [
    { type: "text", text },
    ...(attachments ?? []).map(
      (attachment): acp.ContentBlock => ({
        type: attachment.kind,
        data: attachment.data,
        mimeType: attachment.mimeType,
      }),
    ),
  ];
}
