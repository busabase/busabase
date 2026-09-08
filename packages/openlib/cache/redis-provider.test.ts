import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRedisClient: vi.fn(),
}));

vi.mock("./redis-client", () => ({
  createRedisClient: mocks.createRedisClient,
}));

import { RedisCacheProvider } from "./redis-provider";

const createClient = (connect: () => Promise<void>) => ({
  connect: vi.fn(connect),
  del: vi.fn(async () => 1),
  destroy: vi.fn(),
  eval: vi.fn(async () => 1),
  get: vi.fn(async () => null),
  on: vi.fn(),
  set: vi.fn(async () => "OK"),
});

describe("RedisCacheProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries with a fresh client after the initial connection fails", async () => {
    const failedClient = createClient(async () => {
      throw new Error("connection refused");
    });
    const recoveredClient = createClient(async () => {});
    mocks.createRedisClient
      .mockResolvedValueOnce(failedClient)
      .mockResolvedValueOnce(recoveredClient);

    const provider = new RedisCacheProvider("redis://localhost:6379");

    await provider.set("first", "value");
    await provider.set("second", "value");

    expect(failedClient.destroy).toHaveBeenCalledOnce();
    expect(mocks.createRedisClient).toHaveBeenCalledTimes(2);
    expect(recoveredClient.set).toHaveBeenCalledWith("second", "value");
  });

  it("fails distributed lock acquisition closed when Redis is unavailable", async () => {
    const failedClient = createClient(async () => {
      throw new Error("connection refused");
    });
    mocks.createRedisClient.mockResolvedValue(failedClient);

    const provider = new RedisCacheProvider("redis://localhost:6379");

    await expect(provider.acquireLock("leader", 60)).resolves.toBe(false);
  });

  it("stores and checks the owner token when releasing a lock", async () => {
    const client = createClient(async () => {});
    mocks.createRedisClient.mockResolvedValue(client);
    const provider = new RedisCacheProvider("redis://localhost:6379");

    await expect(provider.acquireLock("retry", 15, "owner-1")).resolves.toBe(true);
    await provider.releaseLock("retry", "owner-1");

    expect(client.set).toHaveBeenCalledWith("retry", "owner-1", { EX: 15, NX: true });
    expect(client.eval).toHaveBeenCalledWith(expect.any(String), {
      keys: ["retry"],
      arguments: ["owner-1"],
    });
    expect(client.del).not.toHaveBeenCalled();
  });

  it("shares one initial connection across concurrent cache operations", async () => {
    let resolveConnect: (() => void) | undefined;
    const client = createClient(
      () =>
        new Promise<void>((resolve) => {
          resolveConnect = resolve;
        }),
    );
    mocks.createRedisClient.mockResolvedValue(client);

    const provider = new RedisCacheProvider("redis://localhost:6379");
    const setPromise = provider.set("first", "value");
    const getPromise = provider.get("second");

    await vi.waitFor(() => expect(client.connect).toHaveBeenCalledOnce());
    resolveConnect?.();
    await Promise.all([setPromise, getPromise]);

    expect(mocks.createRedisClient).toHaveBeenCalledOnce();
    expect(client.connect).toHaveBeenCalledOnce();
  });
});
