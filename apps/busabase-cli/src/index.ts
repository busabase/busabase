// Programmatic surface — consumed by the `busabase` package, which mounts these
// client commands alongside its own `server` command. The client itself lives in
// busabase-sdk (the shared, published client library); re-export it for
// convenience so `busabase-cli` consumers don't need a second import.
export {
  type BusabaseClient,
  createBusabaseClient,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
} from "busabase-sdk";
export { render } from "./format.js";
export { HELP, runCli } from "./run.js";
