import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { describe, expect, it } from "vitest";
import { createChangeRequestQueryKeys } from "./change-request-query-keys";

describe("createChangeRequestQueryKeys", () => {
  it("invalidates the numbered inbox page independently from the cursor list", () => {
    const orpc = createBusabaseQueryUtils("/api/rpc", { batch: false }, "space");

    const keys = createChangeRequestQueryKeys(orpc);

    expect(keys.changeRequestsPaged).toEqual(orpc.changeRequests.listPage.key());
    expect(keys.changeRequestsPaged).not.toEqual(orpc.changeRequests.list.key());
  });
});
