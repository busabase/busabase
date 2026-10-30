import type { AgentConnectionVO } from "busabase-contract/domains/agents/types";
import { describe, expect, it } from "vitest";
import { agentAvailabilityCopy } from "../../../i18n/agent-availability-copy";
import { CORE_LOCALES } from "../../../i18n/locales";
import { getAgentConnectionAvailability, getAgentConnectionState } from "./agent-connection-state";

const connection: AgentConnectionVO = {
  slug: "acprouter:desktop",
  agentName: "Work desktop",
  transport: "remote-websocket",
  connected: true,
  sessionCount: 0,
  latest: null,
  ownedByCurrentUser: true,
};

describe("agent connection availability", () => {
  it("requires confirmed authorization for a remote agent, even without a session", () => {
    const lookup = { slug: connection.slug, pending: false, error: false };
    expect(getAgentConnectionAvailability({ ...lookup, connections: [] }).canChat).toBe(false);
    expect(getAgentConnectionAvailability({ ...lookup, connections: [connection] }).canChat).toBe(
      true,
    );
    expect(getAgentConnectionAvailability({ ...lookup, pending: true }).state).toBe("checking");
    expect(
      getAgentConnectionAvailability({ ...lookup, connections: [connection], error: true }).state,
    ).toBe("unknown");
  });

  it("does not confuse incomplete pairing or a pending disconnect with saved authorization", () => {
    for (const connectionState of ["activating", "disconnecting"] as const) {
      expect(getAgentConnectionState({ ...connection, connectionState })).toBe(connectionState);
      expect(
        getAgentConnectionAvailability({
          slug: connection.slug,
          connections: [{ ...connection, connectionState }],
          pending: false,
          error: false,
        }).canChat,
      ).toBe(false);
    }
  });

  it("does not block starting a local subprocess because its last session ended", () => {
    expect(
      getAgentConnectionAvailability({
        slug: "codex-acp",
        connections: [],
        pending: true,
        error: true,
      }).canChat,
    ).toBe(true);
  });

  it("provides nonempty copy for every supported locale and connection state", () => {
    for (const locale of CORE_LOCALES) {
      const copy = agentAvailabilityCopy(locale);
      expect(Object.keys(copy)).toEqual(Object.keys(agentAvailabilityCopy("en")));
      for (const value of Object.values(copy)) expect(value?.trim().length).toBeGreaterThan(0);
    }
  });
});
