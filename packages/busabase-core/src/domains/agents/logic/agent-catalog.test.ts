import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(() => ({ status: 0 })),
  listBudaConnections: vi.fn(async () => []),
  getBudaConnection: vi.fn(async (slug: string) =>
    new Map([
      [
        "buda:agent-1",
        {
          slug: "buda:agent-1",
          agentId: "agent-1",
          agentName: "Rex",
          accessToken: "access-agent-1",
        },
      ],
      [
        "buda:agent-2",
        {
          slug: "buda:agent-2",
          agentId: "agent-2",
          agentName: "Ada",
          accessToken: "access-agent-2",
        },
      ],
    ]).get(slug),
  ),
}));

vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }));
vi.mock("../../../context", () => ({ getContextActorId: () => undefined }));
vi.mock("./buda-connection", () => ({
  getBudaAcpUrl: (agentId: string) => `wss://buda.example/api/acp?agentId=${agentId}`,
  getBudaConnection: mocks.getBudaConnection,
  listBudaConnections: mocks.listBudaConnections,
}));

import { listCatalog, resolveLaunch } from "./agent-catalog";

describe("agent catalog availability", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.spawnSync.mockReturnValue({ status: 0 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ agents: [] }), { status: 200 })),
    );
  });

  // `getContextActorId` is mocked to `undefined` above — that is the OSS /
  // desktop host, where a local agent runs on the user's own machine.
  it("offers Claude Code and Codex on a local host, once their binary is present", async () => {
    const catalog = await listCatalog();
    const claude = catalog.find((entry) => entry.slug === "claude-acp");
    const codex = catalog.find((entry) => entry.slug === "codex-acp");

    expect(claude).toMatchObject({ comingSoon: false, available: true, unavailableReason: null });
    expect(codex).toMatchObject({ comingSoon: false, available: true, unavailableReason: null });
    // Availability is decided by probing this machine, not by a static flag.
    expect(mocks.spawnSync).toHaveBeenCalled();
  });

  it("says so when the local host is missing the binary, rather than claiming coming-soon", async () => {
    mocks.spawnSync.mockReturnValueOnce({ status: 1 }).mockReturnValueOnce({ status: 1 });
    const catalog = await listCatalog();

    expect(catalog.find((entry) => entry.slug === "claude-acp")).toMatchObject({
      available: false,
      unavailableReason: expect.stringContaining("was not found on this machine"),
    });
    expect(mocks.listBudaConnections).toHaveBeenCalledWith("space");
    expect(mocks.spawnSync).toHaveBeenCalledTimes(2);
  });

  it("launches a local agent on a local host", async () => {
    await expect(resolveLaunch("codex-acp")).resolves.toMatchObject({
      slug: "codex-acp",
      transport: "local-subprocess",
      command: "npx",
      args: ["--yes", "@agentclientprotocol/codex-acp@1.1.14"],
    });
  });

  it("does not use managed Desktop dependencies on an OSS host", async () => {
    vi.stubEnv("APP_ENV", "OSS");
    vi.stubEnv("BUSABASE_DESKTOP_CODEX_HOME", "/tmp/unused-managed-adapter");
    vi.stubEnv("BUSABASE_DESKTOP_CLAUDE_HOME", "/tmp/unused-managed-adapter");
    await expect(resolveLaunch("codex-acp")).resolves.toMatchObject({ command: "npx" });
    await expect(resolveLaunch("claude-acp")).resolves.toMatchObject({ command: "npx" });
  });

  it("rejects a Desktop session before the Codex CLI is installed", async () => {
    vi.stubEnv("APP_ENV", "DESKTOP");
    vi.stubEnv("BUSABASE_DESKTOP_CODEX_CLI", "");
    mocks.spawnSync.mockReturnValue({ status: 1 });
    await expect(resolveLaunch("codex-acp")).rejects.toThrow(/Codex CLI is missing/);
  });

  it("resolves Codex from the repaired sidecar PATH when no startup snapshot exists", async () => {
    vi.stubEnv("APP_ENV", "DESKTOP");
    vi.stubEnv("BUSABASE_DESKTOP_CODEX_CLI", "");
    vi.stubEnv("BUSABASE_DESKTOP_CODEX_SYSTEM_PATH", "");
    vi.stubEnv("PATH", "/late-install/bin:/usr/bin");

    await expect(resolveLaunch("codex-acp")).resolves.toMatchObject({
      command: "npx",
      env: { PATH: "/late-install/bin:/usr/bin" },
    });
    expect(mocks.spawnSync).toHaveBeenCalledWith(
      "codex",
      ["--version"],
      expect.objectContaining({
        env: expect.objectContaining({ PATH: "/late-install/bin:/usr/bin" }),
      }),
    );
  });

  it("resolves Claude npx from the repaired sidecar PATH after startup", async () => {
    vi.stubEnv("APP_ENV", "DESKTOP");
    vi.stubEnv("BUSABASE_DESKTOP_CODEX_SYSTEM_PATH", "");
    vi.stubEnv("PATH", "/late-install/bin:/usr/bin");

    await expect(resolveLaunch("claude-acp")).resolves.toMatchObject({
      command: "npx",
      env: { PATH: "/late-install/bin:/usr/bin" },
    });
  });

  it("uses the Desktop's resolved system PATH for launch", async () => {
    vi.stubEnv("APP_ENV", "DESKTOP");
    vi.stubEnv("BUSABASE_DESKTOP_CODEX_CLI", "/usr/local/bin/codex");
    vi.stubEnv("BUSABASE_DESKTOP_CODEX_SYSTEM_PATH", "/usr/local/bin:/usr/bin");
    await expect(resolveLaunch("codex-acp")).resolves.toMatchObject({
      command: "npx",
      env: { PATH: "/usr/local/bin:/usr/bin" },
    });
  });

  it("prefers system npx for Claude without requiring a separate claude executable", async () => {
    vi.stubEnv("APP_ENV", "DESKTOP");
    vi.stubEnv("BUSABASE_DESKTOP_CODEX_SYSTEM_PATH", "/usr/local/bin:/usr/bin");
    await expect(resolveLaunch("claude-acp")).resolves.toMatchObject({
      command: "npx",
      args: ["--yes", "@agentclientprotocol/claude-agent-acp@0.66.0"],
    });
  });

  it("reuses a validated private Claude adapter and rejects damaged native binaries", async () => {
    const home = mkdtempSync(join(tmpdir(), "busabase-claude-catalog-"));
    tempDirs.push(home);
    const adapter = join(home, "node_modules/@agentclientprotocol/claude-agent-acp");
    const nativePackage = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
    const native = join(
      home,
      "node_modules",
      nativePackage,
      process.platform === "win32" ? "claude.exe" : "claude",
    );
    const entry = join(adapter, "dist/index.js");
    mkdirSync(dirname(entry), { recursive: true });
    mkdirSync(dirname(native), { recursive: true });
    writeFileSync(entry, "adapter");
    writeFileSync(native, "native");
    writeFileSync(
      join(adapter, "package.json"),
      JSON.stringify({
        name: "@agentclientprotocol/claude-agent-acp",
        version: "0.66.0",
        bin: { "claude-agent-acp": "dist/index.js" },
      }),
    );
    const lock = {
      packages: {
        "node_modules/@agentclientprotocol/claude-agent-acp": {
          version: "0.66.0",
          integrity:
            "sha512-BwalxKsxZzHZGEs+X9hV3biErLE7PHWoao2hmyP3QBWXxvMHbc1F1tzDE95ZA47Fle+KBYf2gKpgy1MJ+ZmVlw==",
          resolved:
            "https://registry.npmjs.org/@agentclientprotocol/claude-agent-acp/-/claude-agent-acp-0.66.0.tgz",
        },
        "node_modules/@anthropic-ai/claude-agent-sdk": {
          version: "0.3.220",
          integrity: "sha512-valid-sdk",
          resolved:
            "https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.220.tgz",
        },
        [`node_modules/${nativePackage}`]: {
          version: "0.3.220",
          integrity: "sha512-valid-native",
          resolved: `https://registry.npmjs.org/${nativePackage}/-/${nativePackage.split("/")[1]}-0.3.220.tgz`,
        },
      },
    };
    writeFileSync(join(home, "package-lock.json"), JSON.stringify(lock));
    const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
    writeFileSync(
      join(home, "verified-install.json"),
      JSON.stringify({
        package: "@agentclientprotocol/claude-agent-acp",
        version: "0.66.0",
        integrity: lock.packages["node_modules/@agentclientprotocol/claude-agent-acp"].integrity,
        entrySha256: hash(entry),
        nativeSha256: hash(native),
      }),
    );
    const node = join(home, "node");
    writeFileSync(node, "node");
    vi.stubEnv("APP_ENV", "DESKTOP");
    vi.stubEnv("BUSABASE_DESKTOP_CODEX_SYSTEM_PATH", "");
    vi.stubEnv("BUSABASE_DESKTOP_CLAUDE_HOME", home);
    vi.stubEnv("BUSABASE_DESKTOP_CLAUDE_NODE", node);
    mocks.spawnSync.mockReturnValue({ status: 1 });
    await expect(resolveLaunch("claude-acp")).resolves.toMatchObject({
      command: node,
      args: [entry],
      direct: true,
    });
    writeFileSync(native, "damaged");
    await expect(resolveLaunch("claude-acp")).rejects.toThrow(/Install Claude Code ACP/);
  });

  it("preserves each selected Buda connection identity", async () => {
    await expect(resolveLaunch("buda:agent-1")).resolves.toEqual({
      slug: "buda:agent-1",
      name: "Rex",
      transport: "remote-websocket",
      url: "wss://buda.example/api/acp?agentId=agent-1",
      authHeader: "Bearer access-agent-1",
    });
    await expect(resolveLaunch("buda:agent-2")).resolves.toEqual({
      slug: "buda:agent-2",
      name: "Ada",
      transport: "remote-websocket",
      url: "wss://buda.example/api/acp?agentId=agent-2",
      authHeader: "Bearer access-agent-2",
    });
  });
});
