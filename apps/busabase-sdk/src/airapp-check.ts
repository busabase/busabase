/**
 * The AirApp runtime contract, as checkable rules.
 *
 * These live in the SDK for one reason: **a rule and the runtime it checks must
 * ship together.** The rules below are about `BUSABASE_AIRAPP_RUNTIME`,
 * `__airapp/runtime`, `createBusabaseClient` and `isBusabaseAirAppHosted` — all
 * of which are defined a few files away. Keeping the rules anywhere else means
 * the two drift, and drift here is not hypothetical: an engine rename from
 * `local-node` to `local` broke 66 shipped apps whose runtime detection carried
 * its own private copy of the truth.
 *
 * It also makes them *reachable*. Every AirApp already depends on `busabase-sdk`
 * at an exact pin, so an app's `scripts/check.mjs` shrinks from dozens of
 * hand-copied assertions to reading its files and calling one function. The
 * previous delivery mechanism was "copy these into your check script", and it
 * reached 4 apps out of 67.
 *
 * Pure by design: this module reads no files, spawns nothing, and touches no
 * network. Callers hand it source text. That keeps it usable from a CLI, from an
 * app's own check script, and from a test, without any of them agreeing on a
 * filesystem layout.
 */

/** Severity split: an error breaks a user of the app; a warning is a default worth defending. */
export type AirAppFindingSeverity = "error" | "warning";

export interface AirAppFinding {
  severity: AirAppFindingSeverity;
  /** Stable kebab-case id, so a caller can allowlist or group without matching prose. */
  rule: string;
  message: string;
}

export interface AirAppSources {
  /** Raw `package.json` text. */
  packageJson?: string;
  /**
   * The host's source. **Concatenate the whole server subtree**, not just the entry
   * file — a `server.js` that mounts `server/hono.ts` keeps the runtime route in the
   * module, and passing only the entry reports a correct app as broken. (Observed:
   * two shipped apps failed this way against a collector that read `server.js` alone.)
   */
  server?: string;
  /**
   * Which language the host is written in. Inferred from Python syntax when omitted.
   *
   * NOT the AirApp *runtime* — that is the engine Busabase spawned the process in
   * (`nodepod`, `local`, `sandock`, …), which is a value the app reports at runtime,
   * not a property of its source. Two different things called "runtime" in one
   * domain is how the wrong one ends up being checked.
   */
  serverLanguage?: "node" | "python";
  /**
   * The browser files that carry **logic** — app, config, client, runtime probe,
   * the Busabase provider. The structural rules run over this corpus and no wider.
   *
   * Excluding string tables and demo data is deliberate rather than an oversight:
   * an asset-path or hostname rule false-positives on UI copy that merely *talks*
   * about localhost or shows a path in an error message.
   */
  browserLogic?: string;
  /**
   * **Everything** the browser downloads, copy and `index.html` included.
   *
   * Credentials are scanned over this wider corpus, because a key pasted into a
   * string table ships to the browser exactly like one pasted into `app.js` — and
   * used to pass a gate that only looked at the logic files.
   *
   * **Exclude `app/vendor/`.** A bundled `busabase-sdk` legitimately builds an
   * `Authorization: Bearer …` header from a resolved key, so sweeping the vendor
   * directory in reports every app that bundles the SDK as leaking a credential.
   * List the app's own files; never glob the whole `app/` tree.
   */
  browserDownloads?: string;
  /** `app/js/config.js`, when the app declares its own resources. */
  config?: string;
  /** The slug the package ships this app under, for the `resourceKey` rule. */
  shippedSlug?: string;
}

/** A `busabase-sdk` version must be exact. A range is not the app that was reviewed. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** A `start` script may start the server and nothing else. */
const START_IS_A_BUILD =
  /(?:&&|\|\||;|\bnpm\s+run\s+build\b|\btsc\b|\bvite\b|\bwebpack\b|\bparcel\b)/;

/** An AirApp is Hono plus vanilla browser code. `esbuild` is how the SDK gets bundled. */
const FORBIDDEN_DEPENDENCIES = [
  "react",
  "react-dom",
  "preact",
  "vite",
  "@vitejs/plugin-react",
  "next",
  "webpack",
  "parcel",
];

/**
 * The documented interactive page budget. A higher one may be justified — say so in
 * review — so this is a warning rather than a hard bound. A generator checking its
 * own output is free to be stricter.
 */
export const AIRAPP_DEFAULT_READ_LIMIT = 50;

/**
 * Strip comments before pattern-matching source.
 *
 * Load-bearing, not tidiness. A file that explains a rule necessarily *names* the
 * thing the rule forbids, and matching that prose let a server which had genuinely
 * stopped reading `BUSABASE_AIRAPP_RUNTIME` pass its gate — the comment about the
 * variable satisfied the check for the variable. Prose about a rule must never
 * satisfy the rule.
 */
export const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1 ");

/**
 * Objects inside a `bases: [ ... ]` literal, brace-matched rather than regexed across
 * the array, so a nested `fields:` entry is never mistaken for a Base.
 *
 * Reading the declaration without evaluating the module is the point: a checker must
 * not execute the app it is checking.
 */
export const scanAirAppConfig = (
  source: string,
): {
  bases: { key: string | null; slug: string | null }[];
  drive: { slug: string | null } | null;
  resourceKey: string | null;
} => {
  const anchor = /\bbases\s*:\s*\[/.exec(source);
  const blocks: string[] = [];
  if (anchor) {
    let depth = 0;
    let start = -1;
    for (let index = anchor.index + anchor[0].length - 1; index < source.length; index += 1) {
      const char = source[index];
      if (char === "[") depth += 1;
      else if (char === "]") {
        depth -= 1;
        if (depth === 0) break;
      } else if (char === "{" && depth === 1) {
        if (start === -1) start = index;
        depth += 1;
      } else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 1 && start !== -1) {
          blocks.push(source.slice(start, index + 1));
          start = -1;
        }
      }
    }
  }
  const literal = (block: string, key: string): string | null =>
    new RegExp(`\\b${key}\\s*:\\s*"([^"]*)"`).exec(block)?.[1] ?? null;
  const drive = /\bdrive\s*:\s*\{([\s\S]*?)\}/.exec(source);
  return {
    bases: blocks.map((block) => ({ key: literal(block, "key"), slug: literal(block, "slug") })),
    drive: drive ? { slug: literal(drive[1], "slug") } : null,
    resourceKey: /\bairApp\s*:\s*\{[^}]*\bresourceKey\s*:\s*"([^"]*)"/.exec(source)?.[1] ?? null,
  };
};

/**
 * Check an AirApp against the runtime contract. Returns findings; never throws for a
 * rule violation, so one caller can report every problem at once instead of the first.
 */
export const checkAirApp = (sources: AirAppSources): AirAppFinding[] => {
  const findings: AirAppFinding[] = [];
  const error = (rule: string, message: string) =>
    findings.push({ severity: "error", rule, message });
  const warn = (rule: string, message: string) =>
    findings.push({ severity: "warning", rule, message });

  // ── The app can boot, and is the app the contract allows ────────────────────
  if (sources.packageJson !== undefined) {
    let manifest: { scripts?: Record<string, unknown>; [key: string]: unknown } | undefined;
    try {
      manifest = JSON.parse(sources.packageJson) as typeof manifest;
    } catch (cause) {
      error("airapp/package-json", `package.json is not valid JSON (${(cause as Error).message}).`);
    }
    if (manifest) {
      const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
      if (typeof scripts.dev !== "string") {
        error(
          "airapp/dev-script",
          "package.json has no `dev` script. Busabase boots an app with `npm run dev`, so it installs cleanly and then never starts.",
        );
      }
      if (typeof scripts.start === "string" && START_IS_A_BUILD.test(scripts.start)) {
        error(
          "airapp/start-pure",
          `\`start\` is "${scripts.start}" — a deployed start must only run the server, never build or spawn.`,
        );
      }
      const dependencies = {
        ...((manifest.dependencies ?? {}) as Record<string, unknown>),
        ...((manifest.devDependencies ?? {}) as Record<string, unknown>),
      };
      const sdk = (manifest.dependencies as Record<string, unknown> | undefined)?.["busabase-sdk"];
      if (sdk === undefined) {
        warn("airapp/sdk", "No `busabase-sdk` dependency — the app cannot reach the workspace.");
      } else if (!EXACT_VERSION.test(String(sdk))) {
        error(
          "airapp/sdk-pin",
          `busabase-sdk is "${String(sdk)}". Pin the exact version — a range means the installed app is not the one that was reviewed.`,
        );
      }
      for (const forbidden of FORBIDDEN_DEPENDENCIES) {
        if (dependencies[forbidden] !== undefined) {
          error(
            "airapp/no-framework",
            `Depends on "${forbidden}". An AirApp is Hono plus vanilla HTML/CSS/JS; its files are reviewed and then run as-is, so nothing may need compiling first.`,
          );
        }
      }
    }
  }

  // ── Browser code talks to its own origin, through the SDK ───────────────────
  if (sources.browserLogic !== undefined) {
    const logic = sources.browserLogic;
    const code = stripComments(logic);

    if (!logic.includes("createBusabaseClient")) {
      warn("airapp/sdk-client", "Browser code never calls `createBusabaseClient`.");
    }
    if (logic.includes("__busabase_api__")) {
      error(
        "airapp/legacy-bridge",
        "The obsolete `/__busabase_api__/` bridge prefix is gone. The API is same-origin `/api/v1`.",
      );
    }
    if (/baseUrl\s*:\s*["'`]https?:\/\//.test(code)) {
      error(
        "airapp/absolute-url",
        "A hard-coded absolute Busabase URL in browser code. Use `window.location.origin` — an absolute URL is right in exactly one deployment and wrong in the rest.",
      );
    }
    // `/api/v1/...` is deliberately absolute and unaffected: an API call is not an asset.
    if (/(?:src|href)="\/(?!\/)|from\s+["']\/(?!\/)/.test(code)) {
      error(
        "airapp/absolute-asset",
        "An absolute asset path. Under the Local Node engine the app is proxied onto a sub-path of Busabase's origin, so a leading slash resolves against Busabase itself and 404s.",
      );
    }
    // `while (true) { … if (!nextCursor) return …; cursor = nextCursor; }` is the same
    // violation as `while (cursor)` with the exit condition inverted — genuinely
    // unbounded, since cycle detection catches an infinite loop but not "very many
    // pages". The `while (true)` half is scoped to a loop that calls a paging read,
    // so an unrelated retry/poll loop elsewhere in the file is not swept in.
    if (
      /while\s*\(\s*cursor\s*\)|client\.bases\.list\s*\(/.test(code) ||
      /while\s*\(\s*true\s*\)[\s\S]{0,400}?(?:records\.list|readPage)\s*\(/.test(code)
    ) {
      error(
        "airapp/unbounded-read",
        "Unbounded loading or runtime Base discovery. Every interactive read gets an explicit budget and fetches one page per user action.",
      );
    }
    // A cap does not fix this — it only bounds how bad it gets. `for (page = 0; page <
    // maxPages; …) records.list(…)` inside one function call is the same violation as
    // an unbounded while(cursor) loop: several pages of a Base are fetched in one shot,
    // hidden behind a single loading state, with no user action between pages. Real
    // fleet shape: `readAllRecords(key, { maxPages = 20 } = {}) { for (...) { … } }`,
    // called unconditionally at initial load — up to maxPages × readLimit records
    // (2000 in the observed case) on every open.
    if (/\bmax\w*pages?\w*\s*=\s*\d+[\s\S]{0,400}?(?:client\.)?records\.list\s*\(/i.test(code)) {
      error(
        "airapp/eager-multi-page",
        "A capped loop fetches several pages of records in one function call. A cap bounds the damage but does not fix the shape: this still hides a multi-page scan behind one loading state instead of fetching one page per user action.",
      );
    }

    // ── Runtime detection ─────────────────────────────────────────────────────
    // Does this app have a hosted/standalone branch at all? A connect gate, a
    // `getRuntime()` call, or a `hosted` flag it reads are the shapes that branch.
    const branches =
      /createAirAppConnectGate|getRuntime\s*\(|\bhosted\b/.test(code) ||
      (sources.server !== undefined && /createAirAppConnectGate/.test(sources.server));
    if (/location\s*\.\s*(?:hostname|host)\b/.test(code)) {
      error(
        "airapp/runtime-hostname",
        "Hostname-based runtime detection. Both directions are wrong: a Busabase-hosted AirApp is served from `localhost` on Desktop, and a standalone `npm run dev` is reached over a LAN IP or a signed dev tunnel. Read the runtime from `__airapp/runtime`.",
      );
    }
    if (
      /(?:===|!==|==|!=)\s*["'`][^"'`]*(?:localhost|127\.0\.0\.1)|(?:includes|startsWith|endsWith|indexOf|search|match|test)\s*\(\s*\/?["'`]?[^"'`)]*(?:localhost|127\.0\.0\.1)/.test(
        code,
      )
    ) {
      error(
        "airapp/runtime-loopback",
        "A loopback host comparison. Runtime detection must not depend on the URL at all.",
      );
    }
    // Only an app that BRANCHES on where it is running needs to know. An app that
    // never branches — always calling `/api/v1` on its own origin and letting its dev
    // server proxy when standalone — is not missing a probe, it has nothing to ask.
    // Requiring one anyway told a correctly-designed template it was broken, which is
    // how a checker stops being read.
    if (branches && !logic.includes("__airapp/runtime")) {
      error(
        "airapp/runtime-probe",
        "This app branches on where it is running but never probes `__airapp/runtime`, so that branch is deciding on something else.",
      );
    }
    if (/["'`]\/__airapp\/runtime/.test(logic)) {
      error(
        "airapp/runtime-probe-relative",
        "The runtime probe has a leading slash. It must be relative (`__airapp/runtime`) — a leading slash resolves against Busabase's root under the Local Node sub-path proxy.",
      );
    }
  }

  // ── The host reads the injected variable and re-exposes it ──────────────────
  if (sources.server !== undefined) {
    const server = sources.server;
    const serverCode = stripComments(server);
    const isPython = sources.serverLanguage
      ? sources.serverLanguage === "python"
      : /^\s*(?:import|from)\s+\w+|def\s+\w+\s*\(/m.test(server);

    // A Node host may go through the SDK — one shared definition of "hosted" — or
    // read the variable itself; both are correct. A Python host has no SDK to call.
    const readsRuntimeEnv = isPython
      ? /BUSABASE_AIRAPP_RUNTIME/.test(serverCode)
      : /(?:read|describe)BusabaseAirAppRuntime\s*\(|process\.env\.BUSABASE_AIRAPP_RUNTIME\b/.test(
          serverCode,
        );
    // Same gate as the browser probe: a host only has to expose the runtime if
    // something is going to branch on it.
    const clientBranches =
      sources.browserLogic !== undefined &&
      /createAirAppConnectGate|getRuntime\s*\(|\bhosted\b/.test(
        stripComments(sources.browserLogic),
      );
    if (clientBranches && !readsRuntimeEnv) {
      error(
        "airapp/runtime-env",
        "The server never reads `BUSABASE_AIRAPP_RUNTIME`, directly or through the SDK, so it has nothing to serve at `__airapp/runtime`.",
      );
    }
    if (
      /AIRAPP_HOSTED_RUNTIMES\s*=\s*new Set|hosted:\s*\w*RUNTIMES?\w*\.has\s*\(/.test(serverCode)
    ) {
      error(
        "airapp/runtime-engine-list",
        "Hosting is decided from a hardcoded list of engine names. Use presence, not membership — a private list is what broke 66 apps when `local-node` was renamed `local`.",
      );
    }
    if (clientBranches && !/["'`]\/__airapp\/runtime["'`]/.test(server)) {
      error(
        "airapp/runtime-route",
        "Browser code branches on the runtime but the server does not serve `/__airapp/runtime`.",
      );
    }
    // The dev proxy may reference the env var; it may never carry a literal token.
    if (/Bearer\s+(?!\$\{)[A-Za-z0-9_-]{8,}/.test(server)) {
      error("airapp/credential", "A literal Bearer token in the server source.");
    }
  }

  // ── Nothing the browser downloads carries a credential ──────────────────────
  //
  // Scanned RAW, comments included — a key commented out still ships to the browser
  // verbatim. That rules out `stripComments` here, so the patterns have to be precise
  // instead: matching the bare word `Bearer` reported an app whose only occurrence was
  // a comment explaining that the dev proxy injects one. The distinguishing feature of
  // a leak is a literal secret, never the word for it.
  if (sources.browserDownloads !== undefined) {
    const downloads = sources.browserDownloads;
    if (/BUSABASE_API_KEY/i.test(downloads)) {
      error("airapp/credential", "An API key reference in browser source.");
    }
    if (/Bearer\s+(?!\$\{)[A-Za-z0-9_.-]{8,}/.test(downloads)) {
      error("airapp/credential", "A literal Bearer token in browser source.");
    }
    if (/["'`]\s*Bearer\s*\$\{/.test(downloads)) {
      error(
        "airapp/credential",
        "Browser code builds an Authorization header. A deployed AirApp uses the viewer's ambient same-origin session and needs none.",
      );
    }
  }

  // ── The app's own map of the workspace ──────────────────────────────────────
  if (sources.config !== undefined) {
    const config = scanAirAppConfig(sources.config);
    if (
      sources.shippedSlug !== undefined &&
      config.resourceKey !== null &&
      config.resourceKey !== sources.shippedSlug
    ) {
      error(
        "airapp/resource-key",
        `Config declares resourceKey "${config.resourceKey}" but the package ships this app as "${sources.shippedSlug}". Install stamps nodes with the shipped slug, so the app would not recognise its own node.`,
      );
    }
    for (const base of config.bases) {
      if (base.slug === null) {
        error(
          "airapp/base-slug",
          `Config base "${base.key ?? "(unnamed)"}" has no \`slug\`. The SDK needs it to CREATE the Base, so the app's own provisioning fails even though installing from the package succeeds — install reads base.json and never opens that door.`,
        );
      }
    }
    if (config.drive !== null && config.drive.slug === null) {
      error("airapp/base-slug", "Config `drive` has no `slug`; provisioning it will fail.");
    }
    if (/vaultValue|vaultSecret\s*:\s*["'`][^"'`]/.test(sources.config)) {
      error(
        "airapp/vault-value",
        "A Vault value in config. Config may reference secrets, never carry them.",
      );
    }
    for (const found of sources.config.matchAll(/\breadLimit\s*:\s*(\d+)/g)) {
      const limit = Number(found[1]);
      if (limit < 1) {
        error("airapp/read-budget", `readLimit is ${limit}; it must be a positive integer.`);
      } else if (limit > AIRAPP_DEFAULT_READ_LIMIT) {
        warn(
          "airapp/read-budget",
          `readLimit is ${limit}, above the ${AIRAPP_DEFAULT_READ_LIMIT}-record default page budget. Justify it in review, or page.`,
        );
      }
    }
  }

  return findings;
};
