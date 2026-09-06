import { describe, expect, it } from "vitest";
import { createBusabaseRestApiClient } from "./index";

/**
 * The dashboard facades must forward the caller's merge intent verbatim.
 *
 * This is worth a test of its own because the failure mode is silent and this
 * repo has already shipped it once: `node_archive`'s task layer sent
 * `autoMerge: Boolean(input.autoMerge)`, which turned "the caller said nothing"
 * into an explicit `false` and overrode the endpoint's own permission-aware
 * default from the client side. Nothing type-checks that away, and the symptom
 * — "everything I archive queues for review" — looks like a server policy
 * rather than a client bug.
 *
 * Every dashboard write is a two-mode button ("do it now" / "submit for
 * review"), so which one the user pressed has to reach the wire unchanged. The
 * mirror-image bug is just as quiet: several of these facades used to PIN
 * `autoMerge: false` and replay approve + merge as two extra round trips, and
 * the ones that pinned nothing at all let the endpoint's permission-aware
 * default apply to BOTH modes — so "submit rename for review" merged the rename
 * and then told the user a request was waiting.
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

describe("the other dashboard facades forward it too", () => {
  const capture = async (
    call: (c: ReturnType<typeof createBusabaseRestApiClient>) => Promise<unknown>,
  ) => {
    let body: Record<string, unknown> | undefined;
    const client = createBusabaseRestApiClient("/api/v1", {
      fetch: async (request) => {
        body = JSON.parse(await (request as Request).text()) as Record<string, unknown>;
        throw new Error("transport stopped after capture");
      },
    });
    await expect(call(client)).rejects.toThrow(/transport stopped after capture/);
    return (body?.json ?? body) as Record<string, unknown>;
  };

  it("record create sends the intent instead of a pinned false", async () => {
    expect(
      await capture((c) => c.createChangeRequest("bas_1", { fields: {}, autoMerge: true })),
    ).toMatchObject({ autoMerge: true });
    expect(
      await capture((c) => c.createChangeRequest("bas_1", { fields: {}, autoMerge: false })),
    ).toMatchObject({ autoMerge: false });
  });

  it("field update and reorder send the intent — they used to send nothing at all", async () => {
    expect(
      await capture((c) =>
        c.createUpdateFieldChangeRequest("bas_1", {
          fieldId: "fld_1",
          patch: { name: "x" },
          autoMerge: false,
        }),
      ),
    ).toMatchObject({ operation: "update", autoMerge: false });
    expect(
      await capture((c) =>
        c.createReorderFieldsChangeRequest("bas_1", { fieldIds: ["fld_1"], autoMerge: false }),
      ),
    ).toMatchObject({ operation: "reorder", autoMerge: false });
  });

  it("view create and update send the intent instead of a pinned false", async () => {
    expect(
      await capture((c) =>
        c.createViewChangeRequest("bas_1", { name: "V", slug: "v", autoMerge: true }),
      ),
    ).toMatchObject({ operation: "create", autoMerge: true });
    expect(
      await capture((c) =>
        c.createUpdateViewChangeRequest("viw_1", { name: "V", autoMerge: false }),
      ),
    ).toMatchObject({ operation: "update", autoMerge: false });
  });

  it("the restore family sends it — record restore used to throw on the merged branch", async () => {
    expect(
      await capture((c) => c.createRestoreRecordChangeRequest("rec_1", { autoMerge: true })),
    ).toMatchObject({ operation: "restore", autoMerge: true });
    expect(
      await capture((c) => c.createRestoreBaseChangeRequest("bas_1", { autoMerge: true })),
    ).toMatchObject({ operation: "restore", autoMerge: true });
    expect(
      await capture((c) =>
        c.createRestoreFieldChangeRequest("bas_1", { fieldId: "fld_1", autoMerge: true }),
      ),
    ).toMatchObject({ operation: "restore", autoMerge: true });
    expect(
      await capture((c) => c.createRestoreViewChangeRequest("viw_1", { autoMerge: true })),
    ).toMatchObject({ operation: "restore", autoMerge: true });
  });

  it("deleting a VIEW still pins review-first — it has no do-it-now affordance", async () => {
    expect(await capture((c) => c.createDeleteViewChangeRequest("viw_1"))).toMatchObject({
      operation: "delete",
      autoMerge: false,
    });
  });
});
