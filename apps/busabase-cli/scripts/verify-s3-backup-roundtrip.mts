/**
 * Real, isolated S3-compatible verification of native backup / restore.
 *
 * From the repository root, after building the SDK, CLI and packed Busabase server:
 *   pnpm --filter busabase-cli exec tsx scripts/verify-s3-backup-roundtrip.mts --out /tmp/bb-s3-check
 *
 * Uses a throwaway local MinIO container, three distinct buckets and three
 * packaged Busabase processes. No credentials or existing buckets are reused.
 * The output retains logs, archive and JSON evidence; infrastructure is stopped
 * in finally. --skip-crash allows an initial run before durable receipts exist.
 */
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createBusabaseClient } from "../../busabase-sdk/dist/index.js";

const args = process.argv.slice(2);
const value = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const requestedOutput = args.includes("--out") ? value("--out", "") : undefined;
const output = requestedOutput
  ? path.resolve(requestedOutput)
  : await mkdtemp(path.join(tmpdir(), "busabase-s3-backup-"));
const appBin = path.resolve(
  value("--server-bin", path.join(repo, "apps/busabase/bin/busabase.mjs")),
);
const cliBin = path.resolve(
  value("--cli-bin", path.join(repo, "apps/busabase-cli/bin/busabase-cli.mjs")),
);
const basePort = Number(value("--base-port", "15540"));
assert(Number.isSafeInteger(basePort) && basePort > 1024 && basePort < 65520);
const image = value("--minio-image", "minio/minio:RELEASE.2024-02-26T09-33-48Z");
const skipCrash = args.includes("--skip-crash");
const endpoint = `http://127.0.0.1:${basePort}`;
const publicEndpoint = `http://localhost:${basePort + 6}`;
const adminEndpoint = `http://127.0.0.1:${basePort + 6}`;
const cdnOrigin = `http://127.0.0.1:${basePort + 4}`;
const suffix = randomBytes(6).toString("hex");
const containerName = `bb-backup-s3-${suffix}`;
const user = "backup-test";
const password = randomBytes(24).toString("hex");
const credentialsFile = path.join(output, ".minio.env");
const clientConfig = path.join(output, ".client.env");
const largeBytes = 193_658_660;
const partBytes = 6 * 1024 * 1024;
const processes = new Set<ChildProcess>();
const servers = new Map<string, ChildProcess>();
const buckets = new Map<string, string>();
const evidence: Record<string, unknown> = { output, largeBytes, image, skipCrash, checks: [] };
let containerStarted = false;
let cdnRequests = 0;
const cdn = http.createServer((_request, response) => {
  cdnRequests++;
  response.writeHead(200, { "content-type": "text/html" });
  response.end("CDN MODIFIED BYTES: this response must never enter a full backup");
});
// Older MinIO releases do not enumerate active MPUs via ListMultipartUploads.
// Observe provider-issued IDs without changing signed headers or body bytes,
// then use the authoritative per-upload ListParts API for lifecycle assertions.
const providerUploads = new Map<string, { bucket: string; key: string; uploadId: string }>();
const s3Proxy = http.createServer((request, response) => {
  const upstream = http.request(
    new URL(request.url ?? "/", endpoint),
    {
      method: request.method,
      headers: request.headers,
    },
    (origin) => {
      const url = new URL(request.url ?? "/", endpoint);
      const isInitiation = request.method === "POST" && url.searchParams.has("uploads");
      const captured: Buffer[] = [];
      if (isInitiation) {
        origin.on("data", (chunk: Buffer) => captured.push(chunk));
        origin.on("end", () => {
          if ((origin.statusCode ?? 500) >= 300) return;
          const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(
            Buffer.concat(captured).toString("utf8"),
          )?.[1];
          const [bucket, ...key] = url.pathname.slice(1).split("/").map(decodeURIComponent);
          if (uploadId) providerUploads.set(uploadId, { bucket, key: key.join("/"), uploadId });
        });
      }
      response.writeHead(origin.statusCode ?? 502, origin.headers);
      origin.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end("Isolated S3 test proxy failed");
  });
  request.pipe(upstream);
});
const s3 = new S3Client({
  endpoint: adminEndpoint,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: user, secretAccessKey: password },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const checkpoint = async (stage: string, details: Record<string, unknown>) => {
  (evidence.checks as unknown[]).push({ stage, ...details });
  await writeFile(path.join(output, "result.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ stage, ...details }));
};
const client = (role: string) =>
  createBusabaseClient({
    baseUrl: `http://127.0.0.1:${basePort + (role === "source" ? 1 : role === "target" ? 2 : 5)}`,
    apiKey: "",
    spaceId: "local",
  });
const startServer = async (role: string) => {
  const data = path.join(output, role);
  await mkdir(data, { recursive: true });
  const bucket = buckets.get(role) ?? `bb-backup-${role}-${suffix}`;
  buckets.set(role, bucket);
  const storage = `minio://${user}:${password}@localhost:${basePort + 6}/${bucket}?ssl=false&auto_create=true&internal_endpoint=${encodeURIComponent(adminEndpoint)}`;
  const port = basePort + (role === "source" ? 1 : role === "target" ? 2 : 5);
  const log = createWriteStream(path.join(data, "server.log"), { flags: "a", mode: 0o600 });
  await once(log, "open");
  const child = spawn(
    process.execPath,
    [appBin, "server", "--host", "127.0.0.1", "--port", String(port), "--data", data],
    {
      cwd: repo,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PG_DATABASE_URL: `pglite://${path.join(data, "pgdata")}`,
        STORAGE_URL: storage,
        STORAGE_PUBLIC_BASE_URL: `${cdnOrigin}/${bucket}`,
        BUSABASE_API_KEY: "",
        BUSABASE_SPACE_ID: "local",
      },
      stdio: ["ignore", log, log],
    },
  );
  child.once("close", () => log.end());
  processes.add(child);
  servers.set(role, child);
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`${role} server exited; inspect its private server.log`);
    try {
      const response = await fetch(`${origin}/api/v1/space-instructions`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return;
    } catch {
      /* The isolated server is still starting. */
    }
    await pause(1000);
  }
  throw new Error(`${role} server did not become ready`);
};
const stopServer = async (role: string, signal: NodeJS.Signals = "SIGTERM") => {
  const child = servers.get(role);
  if (!child || child.exitCode !== null) return;
  const ended = once(child, "close");
  child.kill(signal);
  await ended;
  processes.delete(child);
};
const nativeCli = async (name: string, role: string, command: string[]) => {
  const stdoutPath = path.join(output, `${name}.json`);
  const stdout = await open(stdoutPath, "w", 0o600);
  const stderr = await open(path.join(output, `${name}.log`), "w", 0o600);
  const port = basePort + (role === "source" ? 1 : role === "target" ? 2 : 5);
  const child = spawn(
    process.execPath,
    [
      cliBin,
      ...command,
      "--base-url",
      `http://127.0.0.1:${port}`,
      "--space-id",
      "local",
      "--config",
      clientConfig,
      "--output",
      "json",
    ],
    {
      cwd: repo,
      env: { ...process.env, BUSABASE_API_KEY: "", BUSABASE_SPACE_ID: "local" },
      stdio: ["ignore", stdout.fd, stderr.fd],
    },
  );
  processes.add(child);
  try {
    const [code] = await once(child, "close");
    assert.equal(code, 0, `Built CLI ${name} failed; inspect its log`);
    return JSON.parse(await readFile(stdoutPath, "utf8")) as Record<string, unknown>;
  } finally {
    processes.delete(child);
    await stdout.close();
    await stderr.close();
  }
};
const rawRows = async (role: string, table: string) => {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  do {
    const page = await client(role).dump.exportTables({
      table: table as never,
      limit: 2000,
      cursor,
    });
    rows.push(...page.rows);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return rows;
};
const objectDigest = async (role: string, key: string) => {
  const response = await s3.send(new GetObjectCommand({ Bucket: buckets.get(role), Key: key }));
  assert(response.Body);
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    bytes += chunk.byteLength;
    digest.update(chunk);
  }
  return { bytes, sha256: digest.digest("hex") };
};
const multipartState = async (role: string) => {
  const Bucket = buckets.get(role);
  let activeUploads = 0;
  for (const upload of providerUploads.values()) {
    if (upload.bucket !== Bucket) continue;
    try {
      const parts = await s3.send(
        new ListPartsCommand({ Bucket, Key: upload.key, UploadId: upload.uploadId }),
      );
      assert(
        (parts.Parts?.length ?? 0) >= 1,
        "Observed provider multipart has no acknowledged part",
      );
      activeUploads++;
    } catch (error) {
      if ((error as { name?: string }).name !== "NoSuchUpload") throw error;
    }
  }
  const staging = await s3.send(
    new ListObjectsV2Command({ Bucket, Prefix: "busabase/dump-staging" }),
  );
  return { multipartUploads: activeUploads, stagingObjects: staging.Contents?.length ?? 0 };
};
const absent = async (role: string, key: string) => {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: buckets.get(role), Key: key }));
    return false;
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
      return true;
    throw error;
  }
};
const upload = async (fileName: string, bytes: Buffer, mimeType: string) => {
  const source = client("source");
  const expected = { bytes: bytes.length, sha256: sha(bytes) };
  const input = {
    fileName,
    mimeType,
    sizeBytes: bytes.length,
    contentHash: `sha256:${expected.sha256}`,
  };
  const requested = await source.assets.createUploadUrl(input);
  assert.equal(new URL(requested.uploadUrl).origin, publicEndpoint);
  assert(new URL(requested.uploadUrl).searchParams.has("X-Amz-Signature"));
  const response = await fetch(requested.uploadUrl, {
    method: "PUT",
    body: new Uint8Array(bytes),
    headers: { "content-type": mimeType },
  });
  assert.equal(response.status, 200);
  const confirmed = await source.assets.confirm({ ...input, storageKey: requested.storageKey });
  assert(confirmed.assetId);
  await source.files.create({
    slug: fileName.replaceAll(".", "-"),
    name: fileName,
    assetId: confirmed.assetId,
  });
  assert.deepEqual(await objectDigest("source", requested.storageKey), expected);
  const originDownload = await source.dump.exportAttachment({
    attachmentId: confirmed.attachmentId,
  });
  assert.equal(new URL(originDownload.downloadUrl).origin, publicEndpoint);
  assert(new URL(originDownload.downloadUrl).searchParams.has("X-Amz-Signature"));
  return { key: requested.storageKey, attachmentId: confirmed.attachmentId, ...expected };
};

await mkdir(output, { recursive: true, mode: 0o700 });
try {
  await writeFile(credentialsFile, `MINIO_ROOT_USER=${user}\nMINIO_ROOT_PASSWORD=${password}\n`, {
    mode: 0o600,
  });
  await writeFile(clientConfig, "BUSABASE_API_KEY=\n", { mode: 0o600 });
  const launched = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-d",
      "--name",
      containerName,
      "-p",
      `127.0.0.1:${basePort}:9000`,
      "--env-file",
      credentialsFile,
      image,
      "server",
      "/data",
    ],
    { encoding: "utf8" },
  );
  assert.equal(launched.status, 0, launched.stderr);
  containerStarted = true;
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`${endpoint}/minio/health/live`)).ok) break;
    } catch {
      /* Starting. */
    }
    assert(attempt < 60, "Isolated MinIO did not become healthy");
    await pause(500);
  }
  await new Promise<void>((resolve) => cdn.listen(basePort + 4, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => s3Proxy.listen(basePort + 6, "127.0.0.1", resolve));
  await startServer("source");
  await startServer("target");
  await startServer("recovery");
  const body = randomBytes(largeBytes);
  const objects = [
    await upload("large-193mb.bin", body, "application/octet-stream"),
    await upload(
      "unchanged.html",
      Buffer.from("<p>Unmodified HTML. user@example.invalid</p>\n"),
      "text/html",
    ),
  ];
  const shared = await client("source").assets.createUploadUrl({
    fileName: "shared-large.bin",
    mimeType: "application/octet-stream",
    sizeBytes: objects[0].bytes,
    contentHash: `sha256:${objects[0].sha256}`,
  });
  assert.equal(shared.duplicate, true);
  assert.equal(shared.storageKey, objects[0].key);
  assert(shared.assetId);
  await client("source").files.create({
    slug: "shared-large-bin",
    name: "Shared physical attachment",
    assetId: shared.assetId,
  });
  const cdnResponse = await fetch(`${cdnOrigin}/probe`);
  assert((await cdnResponse.text()).startsWith("CDN MODIFIED"));
  await checkpoint("large-signed-upload", {
    objects: objects.map(({ key: _key, ...metadata }) => metadata),
    origin: publicEndpoint,
    cdnOrigin,
    sharedPhysicalAttachmentReused: true,
    passed: true,
  });
  const file = path.join(output, "source.bbdump");
  const backup = await nativeCli("backup", "source", ["backup", "-o", file]);
  assert.equal(backup.blobCount, objects.length, "Shared attachment bytes must be archived once");
  assert.equal(cdnRequests, 1, "Backup fetched modified CDN bytes instead of the signed origin");
  await checkpoint("native-backup-bypasses-cdn", { backup, cdnRequests, passed: true });
  const restored = await nativeCli("restore", "target", ["restore", file]);
  assert.deepEqual(restored.warnings, []);
  assert((restored as { restored: boolean }).restored);
  for (const object of objects)
    assert.deepEqual(await objectDigest("target", object.key), {
      bytes: object.bytes,
      sha256: object.sha256,
    });
  const manifest = (backup as { manifest: { tables: Record<string, number> } }).manifest;
  const comparedTables: Record<string, number> = {};
  for (const table of Object.keys(manifest.tables)) {
    if (["docBodies", "attachmentBlobs", "assetTextBlobs"].includes(table)) continue;
    const expected = (await rawRows("source", table))
      .filter((row) => row.id !== "nod_root")
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const actual = (await rawRows("target", table))
      .filter((row) => row.id !== "nod_root")
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    assert.deepEqual(actual, expected, `Restored table differs: ${table}`);
    comparedTables[table] = actual.length;
  }
  assert.deepEqual(await multipartState("target"), { multipartUploads: 0, stagingObjects: 0 });
  await checkpoint("native-multipart-restore", {
    comparedTables,
    objects: objects.length,
    passed: true,
  });

  // A resumed session can insert zero rows while previously landed rows still
  // point at missing bytes. It must revalidate that old progress before release.
  const missingObject = objects[1];
  await s3.send(new DeleteObjectCommand({ Bucket: buckets.get("target"), Key: missingObject.key }));
  assert(await absent("target", missingObject.key));
  const target = client("target");
  const incomplete = await target.dump.importBegin({ sourceSpaceId: "local", resume: true });
  const replayed = await target.dump.importTables({
    sessionId: incomplete.sessionId,
    table: "attachments",
    rows: await rawRows("source", "attachments"),
  });
  assert.equal(replayed.inserted, 0);
  const rejected = await target.dump.importCommit({ sessionId: incomplete.sessionId });
  assert.equal(rejected.ok, false, "Resume must not approve existing rows with missing bytes");
  assert(rejected.warnings.some((warning) => warning.includes("no bytes")));
  assert((await multipartState("target")).stagingObjects > 0, "Incomplete recovery lost its hold");
  const repaired = await nativeCli("repair-existing-progress", "target", [
    "restore",
    file,
    "--resume",
  ]);
  assert((repaired as { restored: boolean }).restored);
  assert.deepEqual(repaired.warnings, []);
  for (const object of objects)
    assert.deepEqual(await objectDigest("target", object.key), {
      bytes: object.bytes,
      sha256: object.sha256,
    });
  for (const table of Object.keys(manifest.tables)) {
    const withoutRoot = (rows: Array<Record<string, unknown>>) =>
      rows
        .filter((row) => row.id !== "nod_root")
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    assert.deepEqual(
      withoutRoot(await rawRows("target", table)),
      withoutRoot(await rawRows("source", table)),
    );
  }
  assert.deepEqual(await multipartState("target"), { multipartUploads: 0, stagingObjects: 0 });
  await checkpoint("resume-revalidates-existing-progress", {
    replayedRowsInserted: 0,
    missingBytesRefused: true,
    incompleteRecoveryHeld: true,
    nativeResumeRepairedExactBytes: true,
    passed: true,
  });

  const recovery = client("recovery");
  const metadata = {
    storageKey: objects[0].key,
    mimeType: "application/octet-stream",
    base64: body.subarray(0, partBytes).toString("base64"),
    chunk: {
      partNumber: 1,
      totalParts: Math.ceil(body.length / partBytes),
      sizeBytes: body.length,
      sha256: objects[0].sha256,
    },
  };
  const begin = await recovery.dump.importBegin({ sourceSpaceId: "local" });
  assert.equal(begin.blobChunkProtocol, 1);
  const firstPartResponse = await recovery.dump.importTables({
    sessionId: begin.sessionId,
    table: "attachmentBlobs",
    rows: [metadata],
  });
  await checkpoint("abort-fixture-first-part", {
    response: firstPartResponse,
    state: await multipartState("recovery"),
    finalKeyAbsent: await absent("recovery", objects[0].key),
  });
  assert.equal((await multipartState("recovery")).multipartUploads, 1);
  assert(await absent("recovery", objects[0].key));
  await recovery.dump.importAbort({ sessionId: begin.sessionId });
  assert.deepEqual(await multipartState("recovery"), { multipartUploads: 0, stagingObjects: 0 });
  assert(await absent("recovery", objects[0].key));
  await checkpoint("abort-cleans-staged-s3-upload", { passed: true });

  if (!skipCrash) {
    const interrupted = await recovery.dump.importBegin({ sourceSpaceId: "local" });
    await recovery.dump.importTables({
      sessionId: interrupted.sessionId,
      table: "attachmentBlobs",
      rows: [metadata],
    });
    assert.equal((await multipartState("recovery")).multipartUploads, 1);
    const pendingObjects = await s3.send(
      new ListObjectsV2Command({
        Bucket: buckets.get("recovery"),
        Prefix: "busabase/dump-staging-v1/",
      }),
    );
    const receiptKeys = (pendingObjects.Contents ?? []).filter((object) =>
      object.Key?.endsWith("/receipt.json"),
    );
    assert.equal(
      receiptKeys.length,
      1,
      "The packaged server must persist its active restore receipt before a crash",
    );
    const receiptObject = await s3.send(
      new GetObjectCommand({ Bucket: buckets.get("recovery"), Key: receiptKeys[0].Key }),
    );
    assert(receiptObject.Body);
    const receipt = JSON.parse(await receiptObject.Body.transformToString()) as {
      owner: { pid: number };
    };
    assert.equal(
      receipt.owner.pid,
      servers.get("recovery")?.pid,
      "Crash must kill the actual request handler, not just a launcher",
    );
    await stopServer("recovery", "SIGKILL");
    assert.equal(
      (await multipartState("recovery")).multipartUploads,
      1,
      "Crash fixture had no remote multipart to recover",
    );
    await startServer("recovery");
    const resumed = await nativeCli("resume", "recovery", ["restore", file, "--resume"]);
    assert.deepEqual(resumed.warnings, []);
    assert((resumed as { restored: boolean }).restored);
    for (const object of objects)
      assert.deepEqual(await objectDigest("recovery", object.key), {
        bytes: object.bytes,
        sha256: object.sha256,
      });
    assert.deepEqual(await multipartState("recovery"), { multipartUploads: 0, stagingObjects: 0 });
    await checkpoint("crash-and-native-resume", {
      objects: objects.length,
      actualHandlerProcessKilled: true,
      durableReceiptObserved: true,
      passed: true,
    });
  }
  evidence.passed = true;
} catch (error) {
  evidence.passed = false;
  evidence.failure = { name: (error as Error).name, message: (error as Error).message };
  throw error;
} finally {
  for (const child of processes) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  await pause(500);
  for (const child of processes) if (child.exitCode === null) child.kill("SIGKILL");
  cdn.close();
  s3Proxy.close();
  s3.destroy();
  if (containerStarted)
    spawnSync("docker", ["stop", "--time", "3", containerName], { stdio: "ignore" });
  await rm(credentialsFile, { force: true });
  await rm(clientConfig, { force: true });
  evidence.infrastructureStopped = true;
  await writeFile(path.join(output, "result.json"), JSON.stringify(evidence, null, 2));
}
