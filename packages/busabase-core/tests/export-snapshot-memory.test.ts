import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("snapshot producer memory through real HTTP", () => {
  it("streams large escaped CJK payloads within a constrained producer heap", async () => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=512",
        "--conditions=react-server",
        "--import",
        "tsx",
        fileURLToPath(new URL("./helpers/export-snapshot-memory-worker.mts", import.meta.url)),
      ],
      {
        cwd: fileURLToPath(new URL("../../..", import.meta.url)),
        env: { ...process.env, PG_DATABASE_URL: "", STORAGE_URL: "" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors = `${errors}${chunk}`.slice(-16_384);
    });
    const exited = once(child, "exit");
    try {
      const ready = await new Promise<{ ready: string; sqlPayloadBytes: number }>(
        (resolve, reject) => {
          const lines = createInterface({ input: child.stdout });
          child.once("exit", (code) => reject(new Error(`Producer exited ${code}: ${errors}`)));
          lines.on("line", (line) => {
            if (line.startsWith('{"ready":')) resolve(JSON.parse(line));
          });
        },
      );
      const response = await fetch(`${ready.ready}/api/v1/dump/export/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-busabase-space": "memory-proof" },
        body: '{"limit":500}',
      });
      expect(response.status).toBe(200);
      let bytes = 0;
      let tail = "";
      if (!response.body) throw new Error("Missing SSE response body");
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        tail = `${tail}${Buffer.from(chunk).toString("utf8")}`.slice(-16_384);
      }
      expect(bytes).toBeGreaterThan(ready.sqlPayloadBytes);
      expect(tail).toContain('"type":"complete"');
      expect(tail).toContain('"commits":5');
      expect(child.exitCode, errors).toBeNull();
    } catch (error) {
      throw new Error(`Snapshot producer failed: ${errors}`, { cause: error });
    } finally {
      child.kill("SIGTERM");
      await exited;
    }
  }, 120_000);
});
