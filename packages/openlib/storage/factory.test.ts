import { afterEach, describe, expect, it } from "vitest";
import { resetStorage, storage } from "./factory";

describe("storage proxy", () => {
  const previousStorageUrl = process.env.STORAGE_URL;
  const previousNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.STORAGE_URL = previousStorageUrl;
    process.env.NODE_ENV = previousNodeEnv;
    resetStorage();
  });

  it("binds adapter methods so they can read instance state", () => {
    process.env.STORAGE_URL = "local:///tmp/busabase-storage-proxy-test?base_url=/files";
    process.env.NODE_ENV = "production";

    const getPublicUrl = storage.getPublicUrl;

    expect(getPublicUrl("covers/hero.svg")).toBe("/files/covers/hero.svg");
  });
});
