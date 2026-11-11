import fs from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("LocalStorage atomic object publication", () => {
  const roots: string[] = [];
  const original = Buffer.from("the previous complete object");
  const replacement = Buffer.from("the fully verified replacement object");

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  const setup = async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openlib-atomic-copy-"));
    roots.push(root);
    await writeFile(path.join(root, "source.bin"), replacement);
    await writeFile(path.join(root, "target.bin"), original);
    return root;
  };
  const makeStorage = async (root: string) => {
    const { LocalStorage } = await import("./local");
    return new LocalStorage({ provider: "local", bucketName: "local", localRoot: root });
  };

  it("publishes a complete copy and leaves no private temporary object", async () => {
    const root = await setup();
    const storage = await makeStorage(root);
    await storage.copyObject("source.bin", "target.bin");

    expect(await readFile(path.join(root, "target.bin"))).toEqual(replacement);
    expect(await readFile(path.join(root, "source.bin"))).toEqual(replacement);
    expect((await readdir(root)).sort()).toEqual(["source.bin", "target.bin"]);
    expect((await storage.listObjects()).objects.map((object) => object.key).sort()).toEqual([
      "source.bin",
      "target.bin",
    ]);
  });

  it("preserves the visible destination after a partially written copy fails with ENOSPC", async () => {
    const root = await setup();
    let visibleDuringFailure: Buffer | undefined;
    vi.spyOn(fs, "copyFile").mockImplementation(((_source, destination, ...args: unknown[]) => {
      const done = args.at(-1) as (error: NodeJS.ErrnoException | null) => void;
      void (async () => {
        // Model a real copy that opened its output and wrote a prefix before
        // running out of disk. All bytes still go to a real temporary directory.
        await writeFile(destination, replacement.subarray(0, 4));
        visibleDuringFailure = await readFile(path.join(root, "target.bin"));
        done(Object.assign(new Error("No space left on device"), { code: "ENOSPC" }));
      })().catch(done);
    }) as typeof fs.copyFile);
    const storage = await makeStorage(root);

    await expect(storage.copyObject("source.bin", "target.bin")).rejects.toMatchObject({
      code: "ENOSPC",
    });
    expect(visibleDuringFailure).toEqual(original);
    expect(await readFile(path.join(root, "target.bin"))).toEqual(original);
    expect(await readFile(path.join(root, "source.bin"))).toEqual(replacement);
    expect((await readdir(root)).sort()).toEqual(["source.bin", "target.bin"]);
  });

  it("publishes a complete direct upload without leaving private state", async () => {
    const root = await setup();
    const storage = await makeStorage(root);
    const result = await storage.uploadFileToKey(
      replacement,
      "target.bin",
      "application/octet-stream",
    );

    expect(result).toMatchObject({ key: "target.bin", uri: "local://target.bin" });
    expect(await readFile(path.join(root, "target.bin"))).toEqual(replacement);
    expect((await readdir(root)).sort()).toEqual(["source.bin", "target.bin"]);
  });

  it("preserves an existing inline-restored object when its replacement write runs out of space", async () => {
    const root = await setup();
    let visibleDuringFailure: Buffer | undefined;
    vi.spyOn(fs, "writeFile").mockImplementation(((destination, _data, ...args: unknown[]) => {
      const done = args.at(-1) as (error: NodeJS.ErrnoException | null) => void;
      void (async () => {
        if (typeof destination !== "string") throw new Error("Expected an object file path");
        await writeFile(destination, replacement.subarray(0, 4));
        visibleDuringFailure = await readFile(path.join(root, "target.bin"));
        done(Object.assign(new Error("No space left on device"), { code: "ENOSPC" }));
      })().catch(done);
    }) as typeof fs.writeFile);
    const storage = await makeStorage(root);

    await expect(
      storage.uploadFileToKey(replacement, "target.bin", "application/octet-stream"),
    ).rejects.toMatchObject({ code: "ENOSPC" });
    expect(visibleDuringFailure).toEqual(original);
    expect(await readFile(path.join(root, "target.bin"))).toEqual(original);
    expect((await readdir(root)).sort()).toEqual(["source.bin", "target.bin"]);
  });

  it.each(["copy", "upload"] as const)(
    "cleans its temporary %s and preserves the original if publication is refused",
    async (operation) => {
      const root = await setup();
      vi.spyOn(fs, "rename").mockImplementation((_source, _destination, done) => {
        done(Object.assign(new Error("Permission denied"), { code: "EACCES" }));
      });
      const storage = await makeStorage(root);

      const publishing =
        operation === "copy"
          ? storage.copyObject("source.bin", "target.bin")
          : storage.uploadFileToKey(replacement, "target.bin", "application/octet-stream");
      await expect(publishing).rejects.toMatchObject({
        code: "EACCES",
      });
      expect(await readFile(path.join(root, "target.bin"))).toEqual(original);
      expect((await readdir(root)).sort()).toEqual(["source.bin", "target.bin"]);
    },
  );

  it("excludes crash-left private publication state without hiding user .tmp files", async () => {
    const root = await setup();
    const privateName = `.busabase-copy-${"a".repeat(32)}.tmp`;
    const privateWriteName = `.busabase-write-${"b".repeat(32)}.tmp`;
    await writeFile(path.join(root, privateName), "incomplete private copy");
    await writeFile(path.join(root, privateWriteName), "incomplete private write");
    await writeFile(path.join(root, "user.tmp"), "a real user object");
    const storage = await makeStorage(root);

    expect((await storage.listObjects()).objects.map((object) => object.key).sort()).toEqual([
      "source.bin",
      "target.bin",
      "user.tmp",
    ]);
    // Listing must not reap another potentially active copy's private state.
    expect(await readFile(path.join(root, privateName), "utf8")).toBe("incomplete private copy");
    expect(await readFile(path.join(root, privateWriteName), "utf8")).toBe(
      "incomplete private write",
    );
  });
});
