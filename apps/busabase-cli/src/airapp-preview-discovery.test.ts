import { describe, expect, it } from "vitest";
import { buildProgram } from "./run";
import { describeEndpoint } from "./schema-command";

describe("agent AirApp preview discovery", () => {
  it("advertises finite preview commands with the same access levels and inputs as the API", () => {
    const program = buildProgram();
    const group = program.commands.find((command) => command.name() === "airapps");
    expect(group).toBeDefined();
    const start = group?.commands.find((command) => command.name() === "preview-start");
    const state = group?.commands.find((command) => command.name() === "preview-state");
    const stop = group?.commands.find((command) => command.name() === "preview-stop");
    expect(start?.options.find((option) => option.long === "--engine")?.mandatory).toBe(true);
    expect(start?.options.find((option) => option.long === "--node-id")?.mandatory).toBe(true);
    expect(start?.options.some((option) => option.long === "--files-json")).toBe(false);
    expect(start?.options.some((option) => option.long === "--dry-run")).toBe(true);
    expect(state?.options.some((option) => option.long === "--dry-run")).toBe(false);
    expect(stop?.options.some((option) => option.long === "--dry-run")).toBe(true);

    expect(describeEndpoint("airapps.previewStart")).toMatchObject({
      method: "POST",
      path: "/api/v1/airapps/{nodeId}/preview/start",
      command: "busabase-cli airapps preview-start",
      requiredLevel: "write",
      input: { required: ["nodeId", "engine"] },
    });
    expect(describeEndpoint("airapps.previewState")).toMatchObject({
      method: "GET",
      path: "/api/v1/airapps/{nodeId}/preview",
      command: "busabase-cli airapps preview-state",
      requiredLevel: "read",
    });
    expect(describeEndpoint("airapps.previewStop")).toMatchObject({
      method: "POST",
      path: "/api/v1/airapps/{nodeId}/preview/stop",
      command: "busabase-cli airapps preview-stop",
      requiredLevel: "write",
    });
  });
});
