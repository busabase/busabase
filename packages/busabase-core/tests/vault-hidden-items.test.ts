/**
 * Real-database coverage for the Vault items the browser never sees.
 *
 * The hidden-key rules are pure SQL (`notInArray`), so a hand-rolled fake db
 * would only assert that drizzle was called — not that the right rows survive.
 * This runs against the same PGLite instance the rest of the suite uses.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import {
  clearVaultSettings,
  getVaultRuntimeEnv,
  getVaultSettings,
  updatePreviewFileCredential,
  updateVaultSettings,
} from "../src/domains/vault/logic/vault-logic";
import { seedScenario } from "./helpers/seed-scenario";

const { db } = await seedScenario("vault-hidden-items");

const OWNER = null;

const userItem = {
  kind: "secret" as const,
  key: "OPENAI_API_KEY",
  value: "user-visible-secret",
  scopeType: "personal" as const,
  scopeId: null,
  environment: "local" as const,
  description: "",
  access: { runtime: true, reveal: false, edit: true, share: false },
};

const run = <T>(fn: () => Promise<T>) => runWithBusabaseContext({ db }, fn);

describe("hidden Vault items", () => {
  beforeEach(async () => {
    await run(async () => {
      await clearVaultSettings(db, OWNER);
      await updatePreviewFileCredential(db, OWNER, null);
    });
  });

  it("stores the PreviewFile credential without listing it in Settings", async () => {
    await run(async () => {
      await updatePreviewFileCredential(db, OWNER, "preview-secret");

      const settings = await getVaultSettings(db, OWNER);
      expect(settings.items.map((item) => item.key)).not.toContain("PREVIEWFILE_API_KEY");
      await expect(getVaultRuntimeEnv(db, OWNER)).resolves.toMatchObject({
        PREVIEWFILE_API_KEY: "preview-secret",
      });
    });
  });

  it("replaces the credential in place instead of appending a second row", async () => {
    await run(async () => {
      await updatePreviewFileCredential(db, OWNER, "first-secret");
      await updatePreviewFileCredential(db, OWNER, "second-secret");

      await expect(getVaultRuntimeEnv(db, OWNER)).resolves.toMatchObject({
        PREVIEWFILE_API_KEY: "second-secret",
      });
    });
  });

  it("keeps the credential when unrelated Vault settings are saved", async () => {
    await run(async () => {
      await updatePreviewFileCredential(db, OWNER, "preview-secret");
      await updateVaultSettings(db, OWNER, { items: [userItem] });

      const runtime = await getVaultRuntimeEnv(db, OWNER);
      expect(runtime.PREVIEWFILE_API_KEY).toBe("preview-secret");
      expect(runtime.OPENAI_API_KEY).toBe("user-visible-secret");
    });
  });

  it("keeps the credential when the user clears the Vault they can see", async () => {
    await run(async () => {
      await updatePreviewFileCredential(db, OWNER, "preview-secret");
      await updateVaultSettings(db, OWNER, { items: [userItem] });

      await clearVaultSettings(db, OWNER);

      // The Vault screen never listed the PreviewFile key, so clearing that
      // list must not delete it. Settings > File Preview owns its removal.
      const settings = await getVaultSettings(db, OWNER);
      expect(settings.items).toHaveLength(0);
      await expect(getVaultRuntimeEnv(db, OWNER)).resolves.toEqual({
        PREVIEWFILE_API_KEY: "preview-secret",
      });
    });
  });

  it("removes the credential through its own screen", async () => {
    await run(async () => {
      await updatePreviewFileCredential(db, OWNER, "preview-secret");
      await updatePreviewFileCredential(db, OWNER, null);

      await expect(getVaultRuntimeEnv(db, OWNER)).resolves.toEqual({});
    });
  });

  it("ignores an attempt to set the hidden key through ordinary Vault settings", async () => {
    await run(async () => {
      await updateVaultSettings(db, OWNER, {
        items: [{ ...userItem, key: "PREVIEWFILE_API_KEY", value: "smuggled" }],
      });

      await expect(getVaultRuntimeEnv(db, OWNER)).resolves.toEqual({});
    });
  });
});
