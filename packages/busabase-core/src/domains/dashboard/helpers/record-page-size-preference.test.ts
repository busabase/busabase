import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readRememberedRecordPageSize,
  recordPageSizePreferenceKey,
  rememberRecordPageSize,
} from "./record-page-size-preference";

const scope = '["local","usr_1"]';
const baseId = "bas_tasks";

const stubLocalStorage = (storage: Partial<Storage>): void => {
  vi.stubGlobal("window", { localStorage: storage });
};

const inMemoryLocalStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remembered Base page size", () => {
  it("stores a supported size for one workspace, person and Base", () => {
    const storage = inMemoryLocalStorage();
    stubLocalStorage(storage);
    rememberRecordPageSize(scope, baseId, 500);
    expect(readRememberedRecordPageSize(scope, baseId)).toBe(500);
    expect(readRememberedRecordPageSize(scope, "bas_other")).toBeNull();
    expect(readRememberedRecordPageSize('["local","usr_2"]', baseId)).toBeNull();
    expect(storage.getItem(recordPageSizePreferenceKey(scope, baseId))).toBe("500");
  });

  it("ignores a stored value the control no longer offers", () => {
    const storage = inMemoryLocalStorage();
    stubLocalStorage(storage);
    storage.setItem(recordPageSizePreferenceKey(scope, baseId), "75");
    expect(readRememberedRecordPageSize(scope, baseId)).toBeNull();
    storage.setItem(recordPageSizePreferenceKey(scope, baseId), "nope");
    expect(readRememberedRecordPageSize(scope, baseId)).toBeNull();
  });

  it("degrades to no memory when storage is missing or throws", () => {
    expect(readRememberedRecordPageSize(scope, baseId)).toBeNull();
    expect(() => rememberRecordPageSize(scope, baseId, 1000)).not.toThrow();

    stubLocalStorage({
      getItem: () => {
        throw new Error("disabled");
      },
      setItem: () => {
        throw new Error("disabled");
      },
    });
    expect(() => rememberRecordPageSize(scope, baseId, 1000)).not.toThrow();
    expect(readRememberedRecordPageSize(scope, baseId)).toBeNull();
  });
});
