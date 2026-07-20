/**
 * The client seam that lets one implementation of the package format serve two
 * very different callers.
 *
 * `busabase-cli` drives it over HTTP with `busabase-sdk`'s `BusabaseClient`;
 * `busabase-core`'s install domain drives it **in-process** with
 * `createRouterClient(busabaseRouter)` from `@orpc/server` — no HTTP hop, no
 * server talking to itself over the network.
 *
 * Typing this against `BusabaseClient` directly would not work: that type is
 * built from the *cloud* contract, so it carries `system` / `users` /
 * `agentTasks`, which an in-process OSS router client does not have. Deriving it
 * from the OSS contract instead — and narrowing to exactly the slices the
 * package format touches — makes **both** callers structurally assignable with
 * no cast in either direction (verified: `tsc` accepts both assignments).
 *
 * It also keeps this package free of a `busabase-sdk` dependency: the contract is
 * the shared vocabulary, and the SDK is just one of its clients.
 */
import type { ContractRouterClient } from "@orpc/contract";
import type { BusabaseContract } from "busabase-contract/contract/busabase";

/**
 * Every top-level API slice the package format reads or writes. Adding a call on
 * a slice that is not listed here is a compile error, which is the point: it
 * forces a deliberate check that busabase-core's router exposes it too.
 */
export const PACKAGE_CLIENT_SLICES = [
  "airapps",
  "assets",
  "bases",
  "changeRequests",
  "docs",
  "drives",
  "files",
  "nodes",
  "records",
  "skills",
] as const;

export type PackageClientSlice = (typeof PACKAGE_CLIENT_SLICES)[number];

/** The narrowed Busabase API surface `apply` / `collect` are written against. */
export type PackageClient = Pick<ContractRouterClient<BusabaseContract>, PackageClientSlice>;
