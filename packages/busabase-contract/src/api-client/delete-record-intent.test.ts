import { describe, expect, it } from "vitest";
import { createBusabaseRestApiClient } from "./index";

/**
 * `createDeleteChangeRequest` must forward the caller's merge intent verbatim.
 *
 * This is worth a test of its own because the failure mode is silent and this
 * repo has already shipped it once: `node_archive`'s task layer sent
 * `autoMerge: Boolean(input.autoMerge)`, which turned "the caller said nothing"
 * into an explicit `false` and overrode the endpoint's own permission-aware
 * default from the client side. Nothing type-checks that away, and the symptom
 * — "everything I archive queues for review" — looks like a server policy
 * rather than a client bug.
 *
 * The dashboard's delete is a two-mode button ("delete now" / "request
 * review"), so which one the user pressed has to reach the wire unchanged.
 *
 * Asserts the request BODY rather than the result: the point is what leaves the
 * client, and a fake transport that throws after capturing keeps this a pure
 * unit test with no server, no DB, and no oRPC response encoding to imitate.
 */
describe("createDeleteChangeRequest forwards the caller's merge intent", () => {
  const captureBody = async (options?: { autoMerge?: boolean }) => {
    let body: Record<string, unknown> | undefined;
    const client = createBusabaseRestApiClient("/api/v1", {
      // oRPC's RPCLink hands the transport a whole `Request`, not (url, init) —
      // the body has to be read off the Request, and it can only be read once,
      // which is fine because this transport never forwards it.
      fetch: async (request) => {
        body = JSON.parse(await (request as Request).text()) as Record<string, unknown>;
        throw new Error("transport stopped after capture");
      },
    });
    await expect(client.createDeleteChangeRequest("rec_1", options)).rejects.toThrow(
      /transport stopped after capture/,
    );
    // oRPC wraps the procedure input under `json` when it serializes the call.
    const json = (body?.json ?? body) as Record<string, unknown>;
    return json;
  };

  it("omits autoMerge entirely when the caller passes nothing", async () => {
    const json = await captureBody();
    expect(json).toMatchObject({ recordId: "rec_1", operation: "delete", deleteMode: "archive" });
    // Absent, not `false` — an omitted flag is what asks the server for its
    // permission-aware default, and `false` would silently forbid merging.
    expect(json).not.toHaveProperty("autoMerge");
  });

  it("sends autoMerge: true for the 'delete now' mode", async () => {
    expect(await captureBody({ autoMerge: true })).toMatchObject({ autoMerge: true });
  });

  it("sends autoMerge: false for the 'request review' mode", async () => {
    expect(await captureBody({ autoMerge: false })).toMatchObject({ autoMerge: false });
  });
});
