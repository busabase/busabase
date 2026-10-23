import type { Snapshot } from "@r1ck404/nodepod";
import type { RunPlan } from "../../utils/airapp-runtime-descriptor";
import type { AirAppMountedFile } from "./types";

/**
 * A browser-side cache of an AirApp's installed `node_modules`, kept in
 * CacheStorage and keyed by what the install depends on.
 *
 * Nodepod already caches installs, but in IndexedDB. Busabase Desktop renders
 * the dashboard in an iframe whose origin differs from the shell's, and WebKit
 * keeps a third-party iframe's IndexedDB (and localStorage) in memory only —
 * measured in the real Tauri shell: both come back empty on every launch, while
 * CacheStorage survives. So every desktop launch reinstalled every AirApp's
 * dependencies over the network. This cache restores them from CacheStorage
 * instead and skips the install entirely; it works the same in a browser tab.
 *
 * Only the default npm installs are cached: a custom install command may write
 * outside `node_modules` (a build step, say), and restoring only
 * `node_modules` would silently skip that work.
 */

const CACHE_NAME = "busabase-airapp-dependencies";
/** Bump to drop every entry written by an older format or install layout. */
const FORMAT_VERSION = 1;
const CACHEABLE_INSTALLS = new Set(["npm install", "npm i", "npm ci"]);
/** Larger trees are installed normally rather than held twice in memory. */
export const MAX_CACHED_DEPENDENCY_BYTES = 64 * 1024 * 1024;
const NODE_MODULES_PREFIX = "node_modules/";

export type DependencyFiles = Record<string, Uint8Array<ArrayBuffer>>;

const cacheStorage = (): CacheStorage | null => (typeof caches === "undefined" ? null : caches);

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

const textOf = (file: AirAppMountedFile | undefined) =>
  file === undefined ? "" : typeof file === "string" ? file : new TextDecoder().decode(file);

/**
 * Cache key for this app's dependency tree, or null when the run is not
 * cacheable (not a Node app, a custom install command, no `package.json`, or a
 * browser without CacheStorage / WebCrypto).
 */
export const dependencyCacheKey = async (
  files: Record<string, AirAppMountedFile>,
  plan: Pick<RunPlan, "runtime" | "install">,
): Promise<string | null> => {
  if (plan.runtime !== "node" || !CACHEABLE_INSTALLS.has(plan.install.trim())) return null;
  if (files["package.json"] === undefined) return null;
  if (!cacheStorage() || typeof crypto === "undefined" || !crypto.subtle) return null;
  const material = JSON.stringify([
    FORMAT_VERSION,
    plan.install.trim(),
    textOf(files["package.json"]),
    textOf(files["package-lock.json"]),
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  // A CacheStorage key must be an http(s) URL; it is never fetched.
  return `https://airapp-dependencies.invalid/${toHex(digest)}`;
};

const base64ToBytes = (data: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/**
 * The installed `node_modules` files out of a full pod snapshot, keyed the way
 * `Nodepod.boot({ files })` takes them. Null when the tree cannot be restored
 * faithfully through `boot({ files })` (it holds a symlink) or is too large.
 */
export const dependencyFilesFromSnapshot = (
  snapshot: Snapshot,
  maxBytes = MAX_CACHED_DEPENDENCY_BYTES,
): DependencyFiles | null => {
  const files: DependencyFiles = {};
  let total = 0;
  for (const entry of snapshot.entries) {
    const path = entry.path.replace(/^\/+/, "");
    if (!path.startsWith(NODE_MODULES_PREFIX)) continue;
    if (entry.kind === "symlink") return null;
    if (entry.kind !== "file") continue;
    const bytes = base64ToBytes(entry.data ?? "");
    total += bytes.byteLength;
    if (total > maxBytes) return null;
    files[path] = bytes;
  }
  return Object.keys(files).length > 0 ? files : null;
};

// Stored as one binary body: a 4-byte header length, a JSON header of
// [path, byteLength] pairs, then every file's bytes back to back.
export const encodeDependencyFiles = (files: DependencyFiles): Blob => {
  const paths = Object.keys(files);
  const header = new TextEncoder().encode(
    JSON.stringify(paths.map((path) => [path, files[path].byteLength])),
  );
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, header.byteLength);
  return new Blob([length, header, ...paths.map((path) => files[path])]);
};

export const decodeDependencyFiles = (buffer: ArrayBuffer): DependencyFiles => {
  const view = new DataView(buffer);
  const headerLength = view.getUint32(0);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)),
  ) as Array<[string, number]>;
  const files: DependencyFiles = {};
  let offset = 4 + headerLength;
  for (const [path, byteLength] of header) {
    files[path] = new Uint8Array(buffer, offset, byteLength);
    offset += byteLength;
  }
  if (offset !== buffer.byteLength) throw new Error("Truncated dependency cache entry");
  return files;
};

export const loadCachedDependencies = async (key: string): Promise<DependencyFiles | null> => {
  const storage = cacheStorage();
  if (!storage) return null;
  try {
    const response = await (await storage.open(CACHE_NAME)).match(key);
    return response ? decodeDependencyFiles(await response.arrayBuffer()) : null;
  } catch {
    // A corrupt or unreadable entry is a cache miss: the app installs normally.
    return null;
  }
};

export const storeCachedDependencies = async (key: string, files: DependencyFiles) => {
  const storage = cacheStorage();
  if (!storage) return;
  await (await storage.open(CACHE_NAME)).put(key, new Response(encodeDependencyFiles(files)));
};

export const evictCachedDependencies = async (key: string) => {
  const storage = cacheStorage();
  if (!storage) return;
  await (await storage.open(CACHE_NAME)).delete(key);
};
