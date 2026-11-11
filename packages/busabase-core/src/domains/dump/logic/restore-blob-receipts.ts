import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readlink, rename, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { getLocalStoragePath, isLocalStorageProvider, storage } from "openlib/storage";
import { z } from "zod";

export const RESTORE_BLOB_LEASE_MS = 60 * 60 * 1000;
const OWNER_TOKEN = randomBytes(16).toString("hex");
const SESSION_ID = /^dumpsess[a-zA-Z0-9_-]{1,100}$/;
const ReceiptSchema = z.object({
  version: z.literal(1),
  sessionId: z.string().regex(SESSION_ID),
  spaceId: z.string(),
  uploadId: z.string().min(1).max(2048),
  leaseExpiresAt: z.number().safe(),
  owner: z.object({
    token: z.string().regex(/^[a-f0-9]{32}$/),
    host: z.string().nullable(),
    pid: z.number().int().positive(),
  }),
});
export type RestoreBlobReceipt = z.infer<typeof ReceiptSchema>;

let ownerPromise: Promise<RestoreBlobReceipt["owner"]> | undefined;
const getOwner = () => {
  if (ownerPromise) return ownerPromise;
  ownerPromise = (async () => {
    // A PID is meaningful only on the same host boot AND PID namespace. Without
    // both Linux identities, cleanup conservatively waits for lease expiry.
    let host: string | null = null;
    try {
      const [boot, namespace] = await Promise.all([
        readFile("/proc/sys/kernel/random/boot_id", "utf8"),
        readlink("/proc/self/ns/pid"),
      ]);
      host = createHash("sha256")
        .update(`${hostname()}\0${boot.trim()}\0${namespace}`)
        .digest("hex");
    } catch {
      /* Non-Linux providers use renewable leases only. */
    }
    return { token: OWNER_TOKEN, host, pid: process.pid };
  })();
  return ownerPromise;
};

export const restoreReceiptPrefix = (spaceId: string): string =>
  `busabase/dump-staging-v1/${createHash("sha256").update(spaceId).digest("hex")}/`;

export const newRestoreBlobReceipt = async (
  spaceId: string,
  sessionId: string,
  uploadId: string,
): Promise<RestoreBlobReceipt> => ({
  version: 1,
  spaceId,
  sessionId,
  uploadId,
  leaseExpiresAt: Date.now() + RESTORE_BLOB_LEASE_MS,
  owner: await getOwner(),
});

/** S3 PUT is atomic; make local renewal atomic too so a kill cannot truncate its receipt. */
export const writeRestoreBlobReceipt = async (
  key: string,
  receipt: RestoreBlobReceipt,
): Promise<void> => {
  const bytes = Buffer.from(JSON.stringify(receipt));
  if (!isLocalStorageProvider()) {
    await storage.uploadFileToKey(bytes, key, "application/json");
    return;
  }
  const destination = getLocalStoragePath(key);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};

export const assertRestoreBlobReceipt = async (
  key: string,
  expected: RestoreBlobReceipt,
): Promise<void> => {
  let receipt: RestoreBlobReceipt;
  try {
    receipt = ReceiptSchema.parse(JSON.parse((await storage.getObject(key)).toString("utf8")));
  } catch {
    throw new Error(
      "Restore multipart receipt was removed or expired; restart this blob in a fresh import session",
    );
  }
  if (
    receipt.owner.token !== expected.owner.token ||
    receipt.uploadId !== expected.uploadId ||
    receipt.sessionId !== expected.sessionId ||
    receipt.spaceId !== expected.spaceId ||
    receipt.leaseExpiresAt <= Date.now()
  )
    throw new Error("Restore multipart lease is no longer owned by this session");
};

const isMissingMultipart = (error: unknown): boolean => {
  const code =
    typeof error === "object" && error !== null && "name" in error ? error.name : undefined;
  return (
    code === "NoSuchUpload" ||
    /Upload ID does not belong to this key|Invalid upload ID or upload expired/.test(
      error instanceof Error ? error.message : String(error),
    )
  );
};

/** Every deletion stays inside this receipt's derived private directory. Never delete its original target key. */
export const discardRestoreBlobReceipt = async (
  receiptKey: string,
  receipt: RestoreBlobReceipt,
): Promise<void> => {
  const directory = receiptKey.slice(0, -"receipt.json".length);
  const stagingKey = `${directory}object`;
  let uploadExists = false;
  try {
    // LocalStorage.abortMultipartUpload alone only takes an id. Prove its key
    // binding first, so a forged receipt cannot abort another upload's parts.
    await storage.listMultipartParts(stagingKey, receipt.uploadId);
    uploadExists = true;
  } catch (error) {
    if (!isMissingMultipart(error)) throw error;
  }
  if (uploadExists) await storage.abortMultipartUpload(stagingKey, receipt.uploadId);
  await storage.deleteObject(stagingKey);
  // Remove crash-left atomic-renewal temp files as well as the durable receipt.
  const listing = await storage.listObjects(directory, 100);
  for (const object of listing.objects) {
    if (
      object.key === receiptKey ||
      /^receipt\.json\.[a-f0-9]+\.tmp$/.test(object.key.slice(directory.length))
    )
      await storage.deleteObject(object.key);
  }
  await storage.deleteObject(receiptKey);
};

/** Clean only dead/expired uploads in the requested space; live owners retain their parts. */
export const cleanupAbandonedRestoreBlobs = async (
  spaceId: string,
  activeSessionIds: ReadonlySet<string>,
): Promise<void> => {
  const prefix = restoreReceiptPrefix(spaceId);
  const owner = await getOwner();
  let token: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await storage.listObjects(prefix, 1000, token);
    for (const object of page.objects) {
      if (!object.key.endsWith("/receipt.json") || object.size > 16 * 1024) continue;
      const relative = object.key.slice(prefix.length).split("/");
      if (
        relative.length !== 3 ||
        !SESSION_ID.test(relative[0]) ||
        !/^[a-f0-9]{32}$/.test(relative[1])
      )
        continue;
      if (activeSessionIds.has(relative[0])) continue;
      try {
        const parsed = ReceiptSchema.safeParse(
          JSON.parse((await storage.getObject(object.key)).toString("utf8")),
        );
        if (
          !parsed.success ||
          parsed.data.spaceId !== spaceId ||
          parsed.data.sessionId !== relative[0]
        )
          continue;
        const receipt = parsed.data;
        let dead = false;
        if (
          receipt.owner.host !== null &&
          receipt.owner.host === owner.host &&
          receipt.owner.token !== owner.token
        ) {
          try {
            process.kill(receipt.owner.pid, 0);
          } catch (error) {
            dead =
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "ESRCH";
          }
        }
        if (!dead && receipt.leaseExpiresAt > Date.now()) continue;
        await discardRestoreBlobReceipt(object.key, receipt);
      } catch (error) {
        // Preserve the receipt on a provider failure; a later begin/lease sweep
        // can retry cleanup using the same durable upload id.
        console.error("[Dump restore] Could not clean abandoned multipart receipt", error);
      }
    }
    token = page.nextContinuationToken;
    if (token && seen.has(token)) throw new Error("Storage repeated a multipart cleanup cursor");
    if (token) seen.add(token);
  } while (token);
};
