"use client";

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { LocalRunner } from "./local-runner";
import { NodepodRunner } from "./nodepod-runner";
import type { AirAppRunner, AirAppRunnerKind } from "./types";

/**
 * Picks/instantiates an `AirAppRunner` for the given engine kind — the single
 * call site `RunPanel.tsx`'s `useAirAppRunner()` should use instead of
 * constructing `NodepodRunner`/`LocalRunner` directly — the same
 * "pick an adapter by kind" factory shape Buda's agent runtime uses.
 */
export function createAirAppRunner(
  kind: AirAppRunnerKind,
  context: { orpc: BusabaseQueryUtils; nodeId: string },
): AirAppRunner {
  switch (kind) {
    case "nodepod":
      return new NodepodRunner();
    case "local":
      return new LocalRunner({ ...context, engine: "local" });
    case "srt":
      return new LocalRunner({ ...context, engine: "srt" });
    // Same client, same stream: the engine is decided server-side, and a remote
    // sandbox reaches the browser through the identical event sequence.
    case "sandock":
      return new LocalRunner({ ...context, engine: "sandock" });
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown AirApp runner kind: ${exhaustive}`);
    }
  }
}
