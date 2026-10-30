import type { AgentSessionEventVO } from "busabase-contract/domains/agents/types";
import { describe, expect, it } from "vitest";
import { inspectInputReceipt, inspectPermissionReceipt } from "./agent-interaction-receipts";

function event(value: Partial<AgentSessionEventVO>): AgentSessionEventVO {
  return {
    sessionId: "session",
    seq: 1,
    at: "2026-10-26T00:00:00Z",
    kind: "acpExtension",
    ...value,
  };
}
function extension(value: Record<string, unknown>): AgentSessionEventVO {
  return event({
    acpExtension: {
      method: "_buda.im/session_event",
      params: { sessionId: "upstream", event: value },
    },
  });
}
const inputRequest = () =>
  event({
    kind: "inputRequest",
    inputRequest: {
      requestId: "input",
      message: "Pick a format",
      requestedSchema: { type: "object" },
    },
  });
const permissionRequest = () =>
  event({
    kind: "permissionRequest",
    permissionRequest: {
      requestId: "permission",
      title: "Write file",
      options: [
        { optionId: "yes", name: "Allow", kind: "allow_once" },
        { optionId: "no", name: "Reject", kind: "reject_once" },
      ],
    },
  });

describe("input delivery receipts", () => {
  it("distinguishes missing and pending requests without treating answering as a receipt", () => {
    expect(inspectInputReceipt([], "input", { action: "accept" })).toBe("missing");
    expect(
      inspectInputReceipt(
        [inputRequest(), extension({ type: "input_answering", requestId: "input" })],
        "input",
        { action: "accept" },
      ),
    ).toBe("pending");
  });

  it("acknowledges the same confirmed direct answer with object key order ignored and arrays preserved", () => {
    const events = [
      inputRequest(),
      event({
        kind: "inputResolved",
        inputRequestId: "input",
        inputResponse: {
          action: "accept",
          content: { formats: ["PDF", "HTML"], detail: { title: "Report", count: 2 } },
        },
      }),
    ];
    expect(
      inspectInputReceipt(events, "input", {
        action: "accept",
        content: { detail: { count: 2, title: "Report" }, formats: ["PDF", "HTML"] },
      }),
    ).toBe("same");
    expect(
      inspectInputReceipt(events, "input", {
        action: "accept",
        content: { formats: ["HTML", "PDF"], detail: { title: "Report", count: 2 } },
      }),
    ).toBe("conflict");
    expect(inspectInputReceipt(events, "input", { action: "decline" })).toBe("conflict");
  });

  it("uses confirmed replay outcomes even when a duplicate request arrives later", () => {
    const events = [
      extension({
        type: "input_resolved",
        requestId: "input",
        action: "accept",
        content: { format: "PDF" },
      }),
      extension({
        type: "input_request",
        requestId: "input",
        message: "Pick",
        requestedSchema: { type: "object" },
      }),
      inputRequest(),
    ];
    expect(
      inspectInputReceipt(events, "input", { action: "accept", content: { format: "PDF" } }),
    ).toBe("same");
    expect(
      inspectInputReceipt(events, "input", { action: "accept", content: { format: "HTML" } }),
    ).toBe("conflict");
  });

  it("keeps explicit cancel and decline distinct from an accepted answer", () => {
    const cancelled = [
      inputRequest(),
      extension({ type: "input_resolved", requestId: "input", action: "cancel" }),
    ];
    expect(inspectInputReceipt(cancelled, "input", { action: "cancel" })).toBe("same");
    expect(inspectInputReceipt(cancelled, "input", { action: "accept", content: {} })).toBe(
      "conflict",
    );
    expect(
      inspectInputReceipt(
        [extension({ type: "input_resolved", requestId: "input", action: "decline" })],
        "input",
        { action: "decline", content: { ignored: true } },
      ),
    ).toBe("same");
  });

  it("treats absent accepted content as no answers and rejects inconsistent confirmed history", () => {
    const empty = [
      event({
        kind: "inputResolved",
        inputRequestId: "input",
        inputResponse: { action: "accept" },
      }),
    ];
    expect(inspectInputReceipt(empty, "input", { action: "accept", content: {} })).toBe("same");
    expect(
      inspectInputReceipt(
        [...empty, extension({ type: "input_resolved", requestId: "input", action: "decline" })],
        "input",
        { action: "accept" },
      ),
    ).toBe("conflict");
  });
});

describe("permission delivery receipts", () => {
  it("distinguishes a real pending request from missing and unconfirmed events", () => {
    expect(inspectPermissionReceipt([], "permission", "yes")).toBe("missing");
    expect(
      inspectPermissionReceipt(
        [permissionRequest(), extension({ type: "permission_answering", requestId: "permission" })],
        "permission",
        "yes",
      ),
    ).toBe("pending");
  });

  it("acknowledges exactly the confirmed option through direct or extension events", () => {
    const direct = [
      permissionRequest(),
      event({
        kind: "permissionResolved",
        permissionRequestId: "permission",
        permissionOptionId: "no",
      }),
    ];
    expect(inspectPermissionReceipt(direct, "permission", "no")).toBe("same");
    expect(inspectPermissionReceipt(direct, "permission", "yes")).toBe("conflict");
    const replay = [
      extension({ type: "permission_resolved", requestId: "permission", optionId: "yes" }),
      permissionRequest(),
    ];
    expect(inspectPermissionReceipt(replay, "permission", "yes")).toBe("same");
    expect(inspectPermissionReceipt(replay, "permission", "no")).toBe("conflict");
  });

  it("never revives an explicitly cancelled approval or hides contradictory decisions", () => {
    const cancelled = [
      permissionRequest(),
      event({
        acpExtension: {
          method: "_acp-ui/lifecycle",
          params: { event: { type: "permission_cancelled", requestId: "permission" } },
        },
      }),
    ];
    expect(inspectPermissionReceipt(cancelled, "permission", "yes")).toBe("conflict");
    expect(inspectPermissionReceipt(cancelled, "permission", "no")).toBe("conflict");
    const conflicting = [
      extension({ type: "permission_resolved", requestId: "permission", optionId: "yes" }),
      extension({ type: "permission_resolved", requestId: "permission", optionId: "no" }),
    ];
    expect(inspectPermissionReceipt(conflicting, "permission", "yes")).toBe("conflict");
  });

  it("ignores receipts for other interaction identities", () => {
    const other = [
      event({
        kind: "permissionResolved",
        permissionRequestId: "other",
        permissionOptionId: "yes",
      }),
    ];
    expect(inspectPermissionReceipt(other, "permission", "yes")).toBe("missing");
  });
});
