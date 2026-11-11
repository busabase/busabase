import { afterEach, describe, expect, it, vi } from "vitest";
import { defineConversionHost } from "./conversion-host";

describe("defineConversionHost", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("namespaces the queue and cache by host", () => {
    vi.stubEnv("PREVIEWFILE_CONVERSION_QUEUE", "");
    vi.stubEnv("PREVIEWFILE_CONV_CACHE_PREFIX", "");

    expect(defineConversionHost("busabase")).toEqual({
      queueName: "busabase-document-conversion",
      cacheKeyPrefix: "busabase:conv-cache-1:",
      cacheVersion: "busabase-conversion-cache-v1",
    });
    expect(
      defineConversionHost("buda", { cacheVersion: "buda-conversion-cache-v2" }).cacheVersion,
    ).toBe("buda-conversion-cache-v2");
  });

  it("lets a deployment override the names", () => {
    vi.stubEnv("PREVIEWFILE_CONVERSION_QUEUE", "staging-conversion");
    vi.stubEnv("PREVIEWFILE_CONV_CACHE_PREFIX", "staging:conv:");

    expect(defineConversionHost("previewfile")).toMatchObject({
      queueName: "staging-conversion",
      cacheKeyPrefix: "staging:conv:",
    });
  });
});
