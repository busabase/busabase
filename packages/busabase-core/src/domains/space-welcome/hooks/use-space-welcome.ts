"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import { isSpaceWelcomeNodeType } from "busabase-contract/domains/space-welcome/types";

export type SpaceWelcomeDetail = Extract<NodeDetailVO, { type: "doc" | "html" }>;

export type SpaceWelcomeResolution =
  | { state: "pending" }
  | { state: "absent" }
  | { state: "readable"; nodeId: string; detail: SpaceWelcomeDetail };

/**
 * The welcome page as THIS viewer may see it.
 *
 * The welcome setting only holds a node id; the node itself is read through
 * the ordinary `nodes.get`, so its own ACL decides who sees it. Every failure —
 * an old server without the route, a node that was trashed or archived, a type
 * that is no longer a page, or a node this member may not read — resolves to
 * `absent`, indistinguishable from "never configured", and never exposes the
 * node's name or content.
 *
 * Neither request retries: a 404/403 is a definitive answer, and retrying an
 * old server's 404 would hold Home's Getting started back for seconds.
 */
export const useSpaceWelcome = (orpc: BusabaseQueryUtils): SpaceWelcomeResolution => {
  const welcomeQuery = useQuery({
    ...orpc.spaceWelcome.get.queryOptions({}),
    retry: false,
    staleTime: 30_000,
  });
  const nodeId = welcomeQuery.isError ? null : (welcomeQuery.data?.nodeId ?? null);
  const nodeQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId: nodeId ?? "" } }),
    enabled: Boolean(nodeId),
    retry: false,
  });

  if (welcomeQuery.isPending) return { state: "pending" };
  if (!nodeId) return { state: "absent" };
  if (nodeQuery.isPending) return { state: "pending" };
  const detail = nodeQuery.isError ? undefined : nodeQuery.data;
  if (!detail || !isSpaceWelcomeNodeType(detail.type)) return { state: "absent" };
  return { state: "readable", nodeId, detail: detail as SpaceWelcomeDetail };
};
