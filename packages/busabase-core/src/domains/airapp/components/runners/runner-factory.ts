"use client";

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { LocalNodeRunner } from "./local-node-runner";
import { NodepodRunner } from "./nodepod-runner";
import type { AirAppRunner, AirAppRunnerKind } from "./types";

/**
 * Picks/instantiates an `AirAppRunner` for the given engine kind — the single
 * call site `RunPanel.tsx`'s `useAirAppRunner()` should use instead of
 * constructing `NodepodRunner`/`LocalNodeRunner` directly, mirroring
 * `apps/buda`'s `agent/logic/runtime/agent-runtime-operations.ts`
 * `openAgentRuntime()` factory for the same "pick an adapter by kind" shape.
 */
export function createAirAppRunner(
  kind: AirAppRunnerKind,
  context: { orpc: BusabaseQueryUtils; nodeId: string },
): AirAppRunner {
  switch (kind) {
    case "nodepod":
      return new NodepodRunner();
    case "local-node":
      return new LocalNodeRunner({ ...context, engine: "local-node" });
    case "srt":
      return new LocalNodeRunner({ ...context, engine: "srt" });
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown AirApp runner kind: ${exhaustive}`);
    }
  }
}
