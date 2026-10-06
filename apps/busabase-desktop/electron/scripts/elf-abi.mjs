// ELF symbol-version gate for the UOS package.
//
// UOS 20 (1050-1070) is Debian 10 based: glibc 2.28 and libstdc++ from GCC 8.3
// (GLIBCXX_3.4.25, CXXABI_1.3.11). If any shipped binary or native addon
// references a newer symbol version, the dynamic loader refuses to run it —
// exactly the `GLIBC_2.39 not found` failure the Tauri .deb hits. This gate
// fails the build instead of the customer's launch.

import { execFile } from "node:child_process";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const UOS20_ABI_LIMITS = Object.freeze({
  GLIBC: "2.28",
  GLIBCXX: "3.4.25",
  CXXABI: "1.3.11",
});

const compareDotted = (a, b) => {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/**
 * Extract required symbol versions (e.g. `GLIBC_2.34`) from `readelf -V` output.
 * Only the `.gnu.version_r` (verneed) section lists what a file *requires*;
 * `.gnu.version_d` lists what a library *provides*, so it is skipped.
 */
export const parseRequiredVersions = (readelfOutput) => {
  const required = new Set();
  let inVerneed = false;
  for (const line of readelfOutput.split("\n")) {
    if (/^Version needs section/.test(line)) {
      inVerneed = true;
      continue;
    }
    if (/^Version (definition|symbols) section/.test(line)) {
      inVerneed = false;
      continue;
    }
    if (!inVerneed) continue;
    const match = /Name:\s+((?:GLIBC|GLIBCXX|CXXABI)_[0-9.]+)/.exec(line);
    if (match) required.add(match[1]);
  }
  return [...required];
};

/** Symbols in `required` newer than `limits` allows. */
export const exceedsLimits = (required, limits) =>
  required.filter((symbol) => {
    const match = /^(GLIBC|GLIBCXX|CXXABI)_([0-9.]+)$/.exec(symbol);
    if (!match) return false;
    const [, family, version] = match;
    const limit = limits[family];
    return limit !== undefined && compareDotted(version, limit) > 0;
  });

const isElf = async (path) => {
  let handle;
  try {
    handle = await open(path, "r");
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4), 0, 4, 0);
    return bytesRead === 4 && buffer.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
};

async function* walkFiles(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}

/** Scan every ELF file under `root`; returns `{ file, symbol }` for each violation. */
export const findAbiViolations = async (root, limits) => {
  const violations = [];
  for await (const file of walkFiles(root)) {
    if (!(await isElf(file))) continue;
    let output;
    try {
      ({ stdout: output } = await execFileAsync("readelf", ["-V", "-W", file], {
        maxBuffer: 1024 * 1024 * 64,
      }));
    } catch (error) {
      throw new Error(`readelf failed on ${file}: ${error.message}`);
    }
    for (const symbol of exceedsLimits(parseRequiredVersions(output), limits)) {
      violations.push({ file, symbol });
    }
  }
  return violations;
};
