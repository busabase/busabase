/**
 * The one signal an AirApp is allowed to use to answer "am I running inside
 * Busabase, or standalone?".
 *
 * Why an env var and not the hostname: every hostname-shaped test is wrong in
 * both directions. A Busabase-hosted AirApp can be served from `localhost`,
 * `127.0.0.1` or a `.localhost` host (Desktop/OSS runs on
 * `http://localhost:15419`), so "hostname is localhost ⇒ standalone" is wrong;
 * and a standalone `npm run dev` is routinely reached through a LAN IP or a
 * signed dev tunnel (`https://3111-….dev.budaapps.com`), so the negation
 * "hostname is not localhost ⇒ hosted" is wrong too. The second case is the
 * damaging one: the app silently skips its own OAuth gate, calls `/api/v1`
 * with no credential, and reports a connection error the user can't act on.
 *
 * Every engine spawns the AirApp's own process (`npm run dev`), so the host can
 * simply *tell* the app what it is. That is a positive fact the browser cannot
 * fake or misread, and it is independent of hostname, port, tunnel, iframe
 * nesting and sub-path proxying. The app's server (`server.js` in the
 * generated project) reads it and re-exposes it to its own browser code over a
 * relative `__airapp/runtime` endpoint; nothing else in the app may branch on
 * the environment.
 *
 * Absence of the variable is itself meaningful and must stay that way: no
 * variable ⇒ nobody hosted this process ⇒ standalone. So only Busabase may
 * ever set it.
 */

/**
 * Every runtime in which Busabase itself is hosting the AirApp process.
 *
 * Mirrors `AirAppRunnerKind` plus `"embed"`, which is not a runner: it is the
 * embedded-preview host, which spawns nothing and so never appears in a picker.
 *
 * Apps must NOT compare against this list. Presence of the variable is what
 * means "hosted"; a membership test is what broke 66 shipped apps when
 * `local-node` was renamed to `local`, and is now rejected by the app
 * template's own checker. The union exists to keep Busabase's own emitters
 * honest, not to be copied into an app.
 */
export type AirAppHostedRuntime = "browser" | "local" | "remote" | "embed";

/** Env var name — kept here so the two engines and the docs can't drift apart. */
export const AIRAPP_RUNTIME_ENV_VAR = "BUSABASE_AIRAPP_RUNTIME";

/**
 * The env fragment to merge into the AirApp process's environment. Callers
 * spread this into the env they already pass (`PORT`, npm cache, …) rather
 * than setting the variable by hand.
 */
export const airAppRuntimeEnv = (runtime: AirAppHostedRuntime): Record<string, string> => ({
  [AIRAPP_RUNTIME_ENV_VAR]: runtime,
});
