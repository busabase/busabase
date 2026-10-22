import "server-only";

/**
 * Per-request attribution headers, applied ONCE per `/api/v1` request by BOTH
 * servers (Cloud's workbench middleware and the open-source route), inside the
 * already-resolved member/local context:
 *
 * - `x-busabase-agent` — the agent client (Claude Code, Codex…) that made the
 *   call. Normalized here and put into the context's source provenance, where
 *   `withContextSourceMeta` stamps it onto every change request and audit row.
 *   Self-reported; a label for readers, never identity or authorization.
 * - `x-busabase-playbook` — the playbook followed; validated by
 *   `withDeclaredPlaybook`.
 *
 * Reads write nothing to attribute and skip both. A missing or garbage header
 * is dropped silently — attribution never fails a write.
 */

import {
  BUSABASE_AGENT_HEADER,
  normalizeAgentClient,
} from "busabase-contract/contract/agent-client";
import { getContextSourceProvenance, runWithContextAgent } from "../context";
import { withDeclaredPlaybook } from "../domains/playbooks/logic/playbook-attribution";
import { sniffSourceChannel } from "./source-attribution";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const withRequestAttribution = async <T>(
  request: { method: string; headers: Headers },
  fn: () => Promise<T>,
): Promise<T> => {
  const withPlaybook = () => withDeclaredPlaybook(request, fn);
  if (READ_METHODS.has(request.method.toUpperCase())) return withPlaybook();
  const agent = normalizeAgentClient(request.headers.get(BUSABASE_AGENT_HEADER));
  if (!agent) return withPlaybook();
  // A host with no provenance of its own (open source) also names the channel,
  // exactly as it does for a playbook.
  const channel = getContextSourceProvenance() ? null : sniffSourceChannel(request.headers);
  return runWithContextAgent(agent, withPlaybook, channel ? { channel } : undefined);
};
