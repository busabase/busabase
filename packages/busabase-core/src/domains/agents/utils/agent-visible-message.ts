const UNSUPPORTED_HTTP_MCP_NOTE =
  /does not support HTTP MCP servers, so it has no access to this workspace's data\. It can still answer general questions\./;

const ACP_CONNECTION_CLOSED_MESSAGE = /ACP connection closed\.?$/i;

/** Filters retired product notices and transport lifecycle noise from user-visible messages. */
export function shouldRenderAgentMessage(text: string): boolean {
  if (UNSUPPORTED_HTTP_MCP_NOTE.test(text)) return false;
  if (ACP_CONNECTION_CLOSED_MESSAGE.test(text.trim())) return false;
  return true;
}
