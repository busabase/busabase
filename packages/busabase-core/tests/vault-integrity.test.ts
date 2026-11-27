import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearVaultSettings,
  getVaultRuntimeEnv,
  getVaultSettings,
  updateVaultSettings,
} from "../src/domains/vault/logic/vault-logic";
import {
  busabaseVaultItems,
  type VaultValuePayload,
} from "../src/domains/vault/schema/vault-items";
import { VaultSettingsVOSchema } from "../src/domains/vault/types/vault";
import { seedScenario } from "./helpers/seed-scenario";

const { db } = await seedScenario("vault-integrity");
const OWNER = "vault-integrity-owner";
const item = (key = "MAIL_TOKEN", value = "fake-mail-token") => ({
  kind: "secret" as const,
  key,
  value,
  scopeType: "personal" as const,
  scopeId: null,
  environment: "local" as const,
  description: "",
  access: { runtime: true, reveal: true, edit: true, share: false },
});
const internalKeys = [
  "BUDA_ACP_CONNECTION",
  "BUDA_ACP_CONNECTION:agent-1",
  "ACPROUTER_ROUTER_GRANT_TOKEN:grant-1",
  "ACPROUTER_ROUTER_CONNECTION_SECRET:connection-1",
];
const rawRows = () =>
  db.select().from(busabaseVaultItems).where(eq(busabaseVaultItems.userId, OWNER));

beforeEach(async () => {
  await db.delete(busabaseVaultItems);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Vault public management integrity", () => {
  it("keeps internal credentials out of settings and runtime before decrypting them", async () => {
    await db.insert(busabaseVaultItems).values(
      internalKeys.map((key, index) => ({
        id: `internal-${index}`,
        userId: OWNER,
        key,
        kind: "secret" as const,
        // An invalid encrypted value proves these rows are never decoded.
        valuePayload: {
          version: 1,
          encoding: "encrypted",
          algorithm: "aes-256-gcm",
          iv: "invalid",
          tag: "invalid",
          ciphertext: "invalid",
        } as VaultValuePayload,
        access: { runtime: true, reveal: false, edit: false, share: true },
      })),
    );
    await updateVaultSettings(db, OWNER, { items: [item()] });
    const settings = await getVaultSettings(db, OWNER);
    expect(VaultSettingsVOSchema.safeParse(settings).success).toBe(true);
    expect(settings.items.map((row) => row.key)).toEqual(["MAIL_TOKEN"]);
    await expect(getVaultRuntimeEnv(db, OWNER)).resolves.toEqual({ MAIL_TOKEN: "fake-mail-token" });
    const before = (await rawRows()).filter((row) => row.id.startsWith("internal-"));
    await clearVaultSettings(db, OWNER);
    expect(await rawRows()).toEqual(before);
  });

  it("rejects reserved keys, internal IDs, other-owner IDs, and cross-scope reassignment", async () => {
    await db.insert(busabaseVaultItems).values([
      {
        id: "internal-legacy",
        userId: OWNER,
        key: "BUDA_ACP_CONNECTION",
        kind: "secret",
        valuePayload: { version: 1, encoding: "plain", value: "fake-internal-token" },
      },
      {
        id: "another-owner-item",
        userId: "someone-else",
        key: "MAIL_TOKEN",
        kind: "secret",
        valuePayload: { version: 1, encoding: "plain", value: "fake-other-token" },
      },
    ]);
    const saved = await updateVaultSettings(db, OWNER, { items: [item()] });
    const [savedItem] = saved.items;
    const before = await rawRows();
    for (const input of [
      item("BUDA_ACP_CONNECTION", ""),
      { ...item(), id: "internal-legacy" },
      { ...item(), id: "another-owner-item" },
      { ...item(), id: savedItem.id, environment: "production" },
      { ...item(), id: savedItem.id, scopeType: "workspace", scopeId: "other-space" },
      { ...item(), id: "does-not-exist" },
    ]) {
      await expect(updateVaultSettings(db, OWNER, { items: [input] })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(await rawRows()).toEqual(before);
    }
  });

  it("renames a public item in place but refuses reserved or occupied names", async () => {
    const initial = await updateVaultSettings(db, OWNER, {
      items: [item(), item("OTHER_TOKEN", "fake-other-token")],
    });
    const original = initial.items.find((row) => row.key === "MAIL_TOKEN");
    expect(original).toBeDefined();
    const renamed = await updateVaultSettings(db, OWNER, {
      items: initial.items.map((row) =>
        row.id === original?.id ? { ...row, key: "RENAMED_MAIL_TOKEN" } : row,
      ),
    });
    expect(renamed.items.find((row) => row.id === original?.id)).toMatchObject({
      key: "RENAMED_MAIL_TOKEN",
      value: "fake-mail-token",
      createdAt: original?.createdAt,
    });
    const before = await rawRows();
    for (const key of ["BUDA_ACP_CONNECTION", "PREVIEWFILE_API_KEY", "OTHER_TOKEN"]) {
      await expect(
        updateVaultSettings(db, OWNER, {
          items: [{ ...item(key), id: original?.id }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await rawRows()).toEqual(before);
    }
  });

  it("preserves stable identity, creation/use dates, and foreign-key references", async () => {
    const saved = await updateVaultSettings(db, OWNER, { items: [item()] });
    const original = saved.items[0];
    const lastUsedAt = new Date("2026-01-02T00:00:00Z");
    await db
      .update(busabaseVaultItems)
      .set({ lastUsedAt })
      .where(eq(busabaseVaultItems.id, original.id));
    await db.execute(sql`
      CREATE TABLE vault_integrity_reference (
        item_id text REFERENCES busabase_vault_items(id) ON DELETE SET NULL
      )
    `);
    try {
      await db.execute(
        sql`INSERT INTO vault_integrity_reference (item_id) VALUES (${original.id})`,
      );
      const updated = await updateVaultSettings(db, OWNER, {
        items: [item("MAIL_TOKEN", "fake-rotated-token")],
      });
      expect(updated.items[0]).toMatchObject({
        id: original.id,
        createdAt: original.createdAt,
        lastUsedAt: lastUsedAt.toISOString(),
        value: "fake-rotated-token",
      });
      const reference = await db.execute<{ item_id: string }>(
        sql`SELECT item_id FROM vault_integrity_reference`,
      );
      expect(reference.rows[0].item_id).toBe(original.id);
    } finally {
      await db.execute(sql`DROP TABLE vault_integrity_reference`);
    }
  });

  it("writes only the changed item when saving a complete encrypted snapshot", async () => {
    vi.stubEnv("BUSABASE_VAULT_ENCRYPTION_KEY", "vault-integrity-encryption-key");
    const initial = await updateVaultSettings(db, OWNER, {
      items: [item(), item("UNRELATED_TOKEN", "fake-unrelated"), item("REMOVED_TOKEN")],
    });
    const oldUpdatedAt = new Date("2026-01-01T00:00:00Z");
    await db.update(busabaseVaultItems).set({ updatedAt: oldUpdatedAt });
    const before = await rawRows();
    const unrelated = before.find((row) => row.key === "UNRELATED_TOKEN");
    await db.execute(sql`
      CREATE FUNCTION vault_integrity_protect_unchanged() RETURNS trigger AS $$
      BEGIN
        IF OLD.key = 'UNRELATED_TOKEN' THEN
          RAISE EXCEPTION 'An unchanged Vault row was rewritten';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(sql`
      CREATE TRIGGER vault_integrity_protect_unchanged
      BEFORE UPDATE ON busabase_vault_items
      FOR EACH ROW EXECUTE FUNCTION vault_integrity_protect_unchanged();
    `);
    try {
      const updated = await updateVaultSettings(db, OWNER, {
        items: [
          ...initial.items
            .filter((row) => row.key !== "REMOVED_TOKEN")
            .map((row) =>
              row.key === "MAIL_TOKEN" ? { ...row, value: "fake-rotated-token" } : row,
            ),
          item("NEW_TOKEN", "fake-new-token"),
        ],
      });
      const rows = await rawRows();
      expect(rows.find((row) => row.key === "UNRELATED_TOKEN")).toEqual(unrelated);
      expect(rows.find((row) => row.key === "MAIL_TOKEN")?.updatedAt).not.toEqual(oldUpdatedAt);
      expect(updated.items.map((row) => row.key)).toEqual([
        "MAIL_TOKEN",
        "NEW_TOKEN",
        "UNRELATED_TOKEN",
      ]);
      expect(updated.items.find((row) => row.key === "MAIL_TOKEN")?.value).toBe(
        "fake-rotated-token",
      );
    } finally {
      await db.execute(sql`
        DROP TRIGGER vault_integrity_protect_unchanged ON busabase_vault_items;
      `);
      await db.execute(sql`DROP FUNCTION vault_integrity_protect_unchanged()`);
    }
  });

  it.each([true, false])("preserves a normalized no-op snapshot (ids: %s)", async (withIds) => {
    vi.stubEnv("BUSABASE_VAULT_ENCRYPTION_KEY", "vault-integrity-encryption-key");
    const initial = await updateVaultSettings(db, OWNER, { items: [item()] });
    const before = await rawRows();
    const saved = initial.items[0];
    const updated = await updateVaultSettings(db, OWNER, {
      items: [
        {
          ...saved,
          id: withIds ? ` ${saved.id} ` : undefined,
          key: ` ${saved.key} `,
          scopeId: "  ",
          description: "  ",
          access: { share: false, edit: true, reveal: true, runtime: true },
        },
      ],
    });
    expect(await rawRows()).toEqual(before);
    expect(updated).toEqual(initial);
  });

  it.each([
    ["value", { value: "fake-rotated-token" }],
    ["key", { key: "RENAMED_TOKEN" }],
    ["kind", { kind: "variable" }],
    ["description", { description: "Updated description" }],
    ["runtime", { access: { ...item().access, runtime: false } }],
    ["reveal", { access: { ...item().access, reveal: false } }],
    ["edit", { access: { ...item().access, edit: false } }],
    ["share", { access: { ...item().access, share: true } }],
  ])("updates the item revision when %s changes", async (_field, patch) => {
    const initial = await updateVaultSettings(db, OWNER, { items: [item()] });
    const oldUpdatedAt = new Date("2026-01-01T00:00:00Z");
    await db.update(busabaseVaultItems).set({ updatedAt: oldUpdatedAt });
    const updated = await updateVaultSettings(db, OWNER, {
      items: [{ ...initial.items[0], ...patch }],
    });
    expect(updated.items[0]).toMatchObject({ ...patch, id: initial.items[0].id });
    expect(updated.items[0].updatedAt).not.toBe(oldUpdatedAt.toISOString());
  });

  it("retains the old snapshot when encryption fails", async () => {
    vi.stubEnv("BUSABASE_VAULT_ENCRYPTION_KEY", "");
    await updateVaultSettings(db, OWNER, { items: [item()] });
    const before = await rawRows();
    await expect(
      updateVaultSettings(
        db,
        OWNER,
        { items: [item("NEW_TOKEN", "fake-new-token")] },
        { requireEncryption: true },
      ),
    ).rejects.toThrow("BUSABASE_VAULT_ENCRYPTION_KEY");
    expect(await rawRows()).toEqual(before);
  });

  it("rolls back deletions when a real database insert fails", async () => {
    await updateVaultSettings(db, OWNER, { items: [item()] });
    const before = await rawRows();
    await db.execute(sql`
      ALTER TABLE busabase_vault_items
      ADD CONSTRAINT vault_integrity_failure CHECK (key <> 'FAIL_INSERT')
    `);
    try {
      await expect(
        updateVaultSettings(db, OWNER, { items: [item("FAIL_INSERT", "fake-new-token")] }),
      ).rejects.toThrow();
      expect(await rawRows()).toEqual(before);
    } finally {
      await db.execute(
        sql`ALTER TABLE busabase_vault_items DROP CONSTRAINT vault_integrity_failure`,
      );
    }
  });

  it("allows an outer audit transaction to roll back a nested Vault write", async () => {
    await updateVaultSettings(db, OWNER, { items: [item()] });
    const before = await rawRows();
    await expect(
      db.transaction(async (tx) => {
        await updateVaultSettings(tx, OWNER, { items: [item("NEW_TOKEN")] });
        throw new Error("fake audit failure");
      }),
    ).rejects.toThrow("fake audit failure");
    expect(await rawRows()).toEqual(before);
  });

  it("preserves omitted locked items and rejects their modification or clear", async () => {
    const locked = { ...item(), access: { ...item().access, edit: false } };
    const initial = await updateVaultSettings(db, OWNER, {
      items: [locked, item("OTHER_TOKEN", "fake-other")],
    });
    const lockedId = initial.items.find((row) => row.key === "MAIL_TOKEN")?.id;
    const kept = await updateVaultSettings(db, OWNER, { items: [item("OTHER_TOKEN", "changed")] });
    expect(kept.items.some((row) => row.id === lockedId)).toBe(true);
    await expect(
      updateVaultSettings(db, OWNER, { items: [item("MAIL_TOKEN", "fake-overwritten")] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateVaultSettings(db, OWNER, { items: [{ ...item(), access: item().access }] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateVaultSettings(db, OWNER, {
        items: [{ ...locked, id: lockedId, key: "RENAMED_TOKEN" }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(clearVaultSettings(db, OWNER)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "The Vault contains items with edit access disabled. Clear was cancelled.",
    });
    expect((await getVaultSettings(db, OWNER)).items).toEqual(kept.items);
  });

  it("does not decode a disabled public value while resolving runtime configuration", async () => {
    await updateVaultSettings(db, OWNER, { items: [item()] });
    await db.insert(busabaseVaultItems).values({
      id: "disabled-broken-value",
      userId: OWNER,
      key: "DISABLED_TOKEN",
      kind: "secret",
      valuePayload: {
        version: 1,
        encoding: "encrypted",
        algorithm: "aes-256-gcm",
        iv: "invalid",
        tag: "invalid",
        ciphertext: "invalid",
      },
      access: { runtime: false, reveal: false, edit: false, share: false },
    });
    await expect(getVaultRuntimeEnv(db, OWNER)).resolves.toEqual({ MAIL_TOKEN: "fake-mail-token" });
  });

  it("allows an authorized server to edit and omit locked items with an explicit option", async () => {
    const locked = { ...item(), access: { ...item().access, runtime: false, edit: false } };
    const saved = await updateVaultSettings(db, OWNER, {
      items: [locked, { ...locked, key: "OMITTED_TOKEN" }],
    });
    const original = saved.items.find((row) => row.key === "MAIL_TOKEN");
    if (!original) throw new Error("Expected locked Secret fixture");
    const updated = await updateVaultSettings(
      db,
      OWNER,
      { items: [{ ...original, key: "RENAMED_TOKEN", value: "replacement" }] },
      { bypassItemEditPolicy: true },
    );
    expect(updated.items).toHaveLength(1);
    expect(updated.items[0]).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      key: "RENAMED_TOKEN",
      value: "replacement",
      access: locked.access,
    });
    await expect(getVaultRuntimeEnv(db, OWNER)).resolves.toEqual({});
    await expect(clearVaultSettings(db, OWNER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(clearVaultSettings(db, OWNER, { bypassItemEditPolicy: true })).resolves.toEqual({
      success: true,
    });
    expect((await getVaultSettings(db, OWNER)).items).toEqual([]);
  });

  it("does not accept the server edit-policy bypass through public input", async () => {
    const locked = { ...item(), access: { ...item().access, edit: false } };
    await updateVaultSettings(db, OWNER, { items: [locked] });
    const input = {
      items: [item("MAIL_TOKEN", "replacement")],
      bypassItemEditPolicy: true,
    };
    await expect(updateVaultSettings(db, OWNER, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await getVaultSettings(db, OWNER)).items[0]?.value).toBe("fake-mail-token");
  });
});
