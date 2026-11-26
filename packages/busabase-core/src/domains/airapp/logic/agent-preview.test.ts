import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acl: vi.fn(),
  node: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  bytes: vi.fn(),
  start: vi.fn(),
  state: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("../../../logic/node-acl", () => ({ assertNodePermission: mocks.acl }));
vi.mock("../../../logic/seed", () => ({ ensureReady: async () => undefined }));
vi.mock("../../filetree/logic/storage", () => ({ getFileTreeNode: mocks.node }));
vi.mock("../../filetree/handlers", () => ({
  getFileTreeKind: () => ({ type: "airapp" }),
  listFileTreeFiles: mocks.list,
  readFileTreeFile: mocks.read,
  readFileTreeFileBytes: mocks.bytes,
}));
vi.mock("./run-session", () => ({
  startRunSession: mocks.start,
  getRunSessionState: mocks.state,
  stopRunSession: mocks.stop,
}));

import { readAgentPreview, startAgentPreview, stopAgentPreview } from "./agent-preview";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.node.mockResolvedValue({ id: "app", type: "airapp" });
  mocks.state.mockResolvedValue({ status: "stopped" });
  mocks.list.mockResolvedValue([{ path: "server.js" }, { path: "public/logo.png" }]);
  mocks.read.mockImplementation(async (_config, _nodeId, path) =>
    path.endsWith(".png")
      ? { encoding: "url", content: "" }
      : { encoding: "utf8", content: "console.log('persisted');" },
  );
  mocks.bytes.mockResolvedValue(Buffer.from([0, 255, 128, 1]));
  mocks.start.mockResolvedValue({ status: "installing" });
});

describe("starting a preview from merged AirApp source", () => {
  it("mounts text and binary files without asking the agent to send source", async () => {
    await startAgentPreview({ nodeId: "app", engine: "local" });
    expect(mocks.start).toHaveBeenCalledWith({
      nodeId: "app",
      engine: "local",
      files: { "server.js": "console.log('persisted');" },
      binaryFiles: { "public/logo.png": Buffer.from([0, 255, 128, 1]).toString("base64") },
    });
    expect(mocks.acl).toHaveBeenCalledWith("app", "write");
  });

  it("loads real source even if a previous run stops while the request is in flight", async () => {
    mocks.state.mockResolvedValue({ status: "running" });
    await startAgentPreview({ nodeId: "app", engine: "local" });
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        files: { "server.js": "console.log('persisted');" },
      }),
    );
    expect(mocks.state).not.toHaveBeenCalled();
  });

  it("fails before reading files when the caller cannot write", async () => {
    mocks.acl.mockRejectedValue(new ORPCError("FORBIDDEN"));
    await expect(startAgentPreview({ nodeId: "app", engine: "local" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([readAgentPreview, stopAgentPreview])(
    "refuses a missing or wrong-kind node",
    async (operation) => {
      mocks.node.mockResolvedValue(null);
      await expect(operation("app")).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(mocks.state).not.toHaveBeenCalled();
      expect(mocks.stop).not.toHaveBeenCalled();
    },
  );

  it.each(["site", "browser", "remote"])(
    "honors a binding %s engine requirement",
    async (requiredEngine) => {
      mocks.list.mockResolvedValue([{ path: "airapp.json" }]);
      mocks.read.mockResolvedValue({
        encoding: "utf8",
        content: JSON.stringify({ requiredEngine }),
      });
      await expect(startAgentPreview({ nodeId: "app", engine: "local" })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(mocks.start).not.toHaveBeenCalled();
    },
  );

  it("reports an invalid manifest before starting a process", async () => {
    mocks.list.mockResolvedValue([{ path: "airapp.json" }]);
    mocks.read.mockResolvedValue({ encoding: "utf8", content: "broken json" });
    await expect(startAgentPreview({ nodeId: "app", engine: "local" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("reads status at read permission and stops only at write permission", async () => {
    await readAgentPreview("app");
    expect(mocks.acl).toHaveBeenLastCalledWith("app", "read");
    await stopAgentPreview("app");
    expect(mocks.acl).toHaveBeenLastCalledWith("app", "write");
    expect(mocks.stop).toHaveBeenCalledWith("app");
  });
});
