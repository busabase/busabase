import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEWFILE_DEFAULT_MAX_FILE_SIZE_MB,
  resolveCloudFilePreviewRuntimeConfig,
  resolveFilePreviewRuntimeConfig,
  resolveOssFilePreviewRuntimeConfig,
} from "../src/domains/filetree/logic/preview-config";

describe("resolveFilePreviewRuntimeConfig", () => {
  afterEach(() => vi.restoreAllMocks());

  it("defaults to the built-in provider", () => {
    const config = resolveFilePreviewRuntimeConfig({
      credentialSource: "environment",
      env: {},
    });

    expect(config).toMatchObject({
      provider: "builtin",
      credentialSource: "none",
      baseUrl: "https://previewfile.dev",
      maxFileSizeBytes: PREVIEWFILE_DEFAULT_MAX_FILE_SIZE_MB * 1024 * 1024,
      sessionTtlMinutes: 60,
    });
    expect(config.configurationError).toBeUndefined();
  });

  it("accepts a localhost HTTP endpoint in development", () => {
    const config = resolveFilePreviewRuntimeConfig({
      apiKey: "secret",
      credentialSource: "environment",
      env: {
        NODE_ENV: "development",
        BUSABASE_FILE_PREVIEW_PROVIDER: "previewfile",
        PREVIEWFILE_BASE_URL: "http://localhost:4321/",
        PREVIEWFILE_MAX_FILE_SIZE_MB: "125",
      },
    });

    expect(config).toMatchObject({
      provider: "previewfile",
      apiKey: "secret",
      credentialSource: "environment",
      baseUrl: "http://localhost:4321",
      maxFileSizeBytes: 125 * 1024 * 1024,
    });
    expect(config.configurationError).toBeUndefined();
  });

  it("ignores PreviewFile-only values while the built-in provider is active", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = resolveFilePreviewRuntimeConfig({
      credentialSource: "environment",
      env: {
        NODE_ENV: "production",
        BUSABASE_FILE_PREVIEW_PROVIDER: "builtin",
        PREVIEWFILE_BASE_URL: "http://not-used.example",
        PREVIEWFILE_MAX_FILE_SIZE_MB: "999",
      },
    });

    expect(config.provider).toBe("builtin");
    expect(config.configurationError).toBeUndefined();
    expect(warning).not.toHaveBeenCalled();
  });

  it("rejects unknown providers and out-of-range limits without leaking values", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = resolveFilePreviewRuntimeConfig({
      apiKey: "must-not-appear",
      credentialSource: "environment",
      env: {
        NODE_ENV: "production",
        BUSABASE_FILE_PREVIEW_PROVIDER: "other",
        PREVIEWFILE_MAX_FILE_SIZE_MB: "501",
      },
    });

    expect(config.provider).toBe("builtin");
    expect(config.configurationError).toContain("BUSABASE_FILE_PREVIEW_PROVIDER");
    expect(warning.mock.calls.flat().join(" ")).not.toContain("must-not-appear");
  });

  it("requires HTTPS outside local development", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = resolveFilePreviewRuntimeConfig({
      apiKey: "secret",
      credentialSource: "environment",
      env: {
        NODE_ENV: "production",
        BUSABASE_FILE_PREVIEW_PROVIDER: "previewfile",
        PREVIEWFILE_BASE_URL: "http://localhost:4321",
      },
    });

    expect(config.configurationError).toContain("HTTPS");
    expect(config.baseUrl).toBe("https://previewfile.dev");
  });

  it("keeps Cloud and OSS credential sources isolated", () => {
    const env = {
      BUSABASE_FILE_PREVIEW_PROVIDER: "previewfile",
      PREVIEWFILE_API_KEY: "cloud-key",
    };

    expect(resolveCloudFilePreviewRuntimeConfig(env).apiKey).toBe("cloud-key");
    expect(
      resolveOssFilePreviewRuntimeConfig({ PREVIEWFILE_API_KEY: "vault-key" }, env).apiKey,
    ).toBe("vault-key");
    expect(resolveOssFilePreviewRuntimeConfig({}, env).apiKey).toBeUndefined();
  });
});
