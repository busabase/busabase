import { describe, expect, it } from "vitest";
import { mentionDestination } from "./mention-destination";

describe("mentionDestination", () => {
  it("opens the change request an operation comment belongs to, at that operation", () => {
    expect(mentionDestination("/inbox/cr_1/op_2")).toEqual({
      kind: "operation",
      changeRequestId: "cr_1",
      operationId: "op_2",
    });
  });

  it("opens the change request for a change-request comment", () => {
    expect(mentionDestination("/inbox/cr_1")).toEqual({
      kind: "change-request",
      changeRequestId: "cr_1",
    });
  });

  it("opens the record itself, not the Base, for a record comment", () => {
    // The dashboard path carries the Base slug because its record page lives
    // under the Base. The phone has a record route and does not need it.
    expect(mentionDestination("/base/contacts/rec_9")).toEqual({
      kind: "record",
      recordId: "rec_9",
    });
  });

  it("has nowhere to go for a commit-scoped comment", () => {
    // The row still renders — that is the whole point of the server returning
    // it with a null href instead of filtering it out.
    expect(mentionDestination(null)).toEqual({ kind: "none" });
    expect(mentionDestination(undefined)).toEqual({ kind: "none" });
    expect(mentionDestination("")).toEqual({ kind: "none" });
  });

  it("refuses to guess at a shape it does not know", () => {
    // The server may grow a fourth shape before this app ships an update for
    // it. Opening the wrong screen would be worse than opening none: the
    // reader would have no way to tell they were sent somewhere else.
    expect(mentionDestination("/whiteboard/wb_1")).toEqual({ kind: "none" });
    expect(mentionDestination("/inbox")).toEqual({ kind: "none" });
    expect(mentionDestination("/base/contacts")).toEqual({ kind: "none" });
  });

  it("tolerates the slashes a path can legitimately carry", () => {
    expect(mentionDestination("/inbox/cr_1/")).toEqual({
      kind: "change-request",
      changeRequestId: "cr_1",
    });
  });
});
