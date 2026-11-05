import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { describe, expect, it } from "vitest";
import type { BusabaseConnection } from "~/connection/types";
import { getMobileQueryScope, isMobileQueryInScope } from "./mobile-query-scope";

const connection: BusabaseConnection = {
  serverUrl: "https://busabase.com",
  mode: "cloud",
  connectedAt: "2026-11-03T00:00:00.000Z",
  cloudUser: { id: "user-a" },
  selectedSpace: { id: "space-a", name: "A", slug: null, plan: null },
};

describe("mobile query scope", () => {
  it("separates servers, accounts, workspaces and connection modes", () => {
    const connections = [
      connection,
      { ...connection, serverUrl: "https://other.example" },
      { ...connection, cloudUser: { id: "user-b" } },
      { ...connection, selectedSpace: { ...connection.selectedSpace!, id: "space-b" } },
      { ...connection, mode: "demo" as const },
    ];
    expect(new Set(connections.map(getMobileQueryScope)).size).toBe(connections.length);
  });

  it("normalizes a trailing server slash without including ephemeral timestamps", () => {
    expect(getMobileQueryScope({ ...connection, serverUrl: "https://busabase.com/" })).toBe(
      getMobileQueryScope({ ...connection, connectedAt: "later" }),
    );
  });

  it("recognizes generated oRPC families and native custom query keys", () => {
    const scope = getMobileQueryScope(connection);
    const orpc = createBusabaseQueryUtils("https://busabase.com/api/rpc/core", {}, scope);
    const standard = orpc.records.get.queryOptions({ input: { recordId: "record-a" } }).queryKey;
    expect(isMobileQueryInScope(standard, scope)).toBe(true);
    expect(isMobileQueryInScope([scope, "base-records", "base-a"], scope)).toBe(true);
    expect(isMobileQueryInScope(["other", "base-records"], scope)).toBe(false);
    expect(isMobileQueryInScope([["other", "records", "get"], {}], scope)).toBe(false);
  });
});
