// Programmatic surface — consumed by the `busabase` package, which mounts these
// client commands alongside its own `server` command.
export {
  type BusabaseClient,
  createBusabaseClient,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  type ResolvedConfig,
} from "./client.js";
export { render } from "./format.js";
export { HELP, runCli } from "./run.js";
