import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Each run owns its PGLite and storage directories, including failed tests.
// The default suite must never write these fixtures into the user's dev data.
const directory = await mkdtemp(path.join(os.tmpdir(), "busabase-gallery-e2e-"));
const child = spawn("pnpm", ["exec", "next", "dev", "-p", process.argv[2]], {
  stdio: "inherit",
  detached: true,
  env: {
    ...process.env,
    PG_DATABASE_URL: `pglite://${directory}/db`,
    STORAGE_URL: `local:${directory}/storage?base_url=/api/storage&upload_url=/api/storage/upload`,
  },
});
let stopping = false;
const stop = () => {
  stopping = true;
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.once("error", async (error) => {
  console.error(error);
  await rm(directory, { recursive: true, force: true });
  process.exitCode = 1;
});
// Wait for inherited pipes to close as well as pnpm's exit before deleting data.
child.once("close", async (code) => {
  await rm(directory, { recursive: true, force: true });
  process.exitCode = code ?? (stopping ? 0 : 1);
});
