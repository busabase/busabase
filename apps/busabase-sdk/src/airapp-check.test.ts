/**
 * Every rule has to do two things: stay silent on a correct AirApp, and fire on the
 * one mistake it exists for. A rule set only tested against a passing fixture is
 * indistinguishable from `() => []`.
 *
 * Each case starts from the same valid sources and breaks exactly one thing.
 */
import { describe, expect, it } from "vitest";

import {
  type AirAppSources,
  checkAirApp,
  codeOnly,
  findForcedReview,
  isAirAppWriteRuleSource,
  scanAirAppConfig,
  stripComments,
} from "./airapp-check";

const PACKAGE_JSON = JSON.stringify({
  name: "my-desk-airapp",
  private: true,
  type: "module",
  scripts: { dev: "node server.js", start: "node server.js", check: "node scripts/check.mjs" },
  dependencies: { "@hono/node-server": "2.0.8", "busabase-sdk": "0.20.0", hono: "4.12.29" },
});

const SERVER = `
import { serve } from "@hono/node-server";
const airappRuntime = (process.env.BUSABASE_AIRAPP_RUNTIME || "").trim();
app.get("/__airapp/runtime", (context) =>
  context.json({ runtime: airappRuntime || "standalone", hosted: airappRuntime !== "" }),
);
serve(app);
`;

const BROWSER_LOGIC = `
import { createBusabaseClient } from "busabase-sdk";
const client = createBusabaseClient({ baseUrl: window.location.origin });
export async function getRuntime() {
  const response = await fetch("__airapp/runtime", { headers: { accept: "application/json" } });
  return response.json();
}
const rows = await client.records.list({ baseId, limit: base.readLimit });
`;

const BROWSER_DOWNLOADS = `${BROWSER_LOGIC}\n<html><body><script type="module" src="js/app.js"></script></body></html>`;

const CONFIG = `
export const appConfig = {
  appId: "my-desk",
  airApp: { name: "My Desk", slug: "my-desk-app", resourceKey: "my-desk-app" },
  bases: [
    { key: "reviews", slug: "my-desk-reviews", name: "Reviews", readLimit: 50, fields: [] },
  ],
  drive: { slug: "my-desk-files", name: "Files" },
};
`;

const sources = (overrides: Partial<AirAppSources> = {}): AirAppSources => ({
  packageJson: PACKAGE_JSON,
  server: SERVER,
  serverLanguage: "node",
  browserLogic: BROWSER_LOGIC,
  browserDownloads: BROWSER_DOWNLOADS,
  config: CONFIG,
  shippedSlug: "my-desk-app",
  ...overrides,
});

const rules = (input: AirAppSources, severity: "error" | "warning" = "error") =>
  checkAirApp(input)
    .filter((finding) => finding.severity === severity)
    .map((finding) => finding.rule);

describe("a correct AirApp", () => {
  it("reports no errors", () => {
    expect(rules(sources())).toEqual([]);
  });

  it("reports no warnings either, so warnings stay meaningful", () => {
    expect(rules(sources(), "warning")).toEqual([]);
  });

  it("checks only what it was given", () => {
    expect(checkAirApp({})).toEqual([]);
  });
});

describe("the app can boot", () => {
  it("catches a missing dev script", () => {
    const packageJson = JSON.stringify({ scripts: { start: "node server.js" } });
    expect(rules(sources({ packageJson }))).toContain("airapp/dev-script");
  });

  it("catches a start script that builds", () => {
    const packageJson = JSON.stringify({
      scripts: { dev: "node server.js", start: "npm run build && node server.js" },
    });
    expect(rules(sources({ packageJson }))).toContain("airapp/start-pure");
  });

  it("catches an SDK version range", () => {
    const packageJson = JSON.stringify({
      scripts: { dev: "node server.js" },
      dependencies: { "busabase-sdk": "^0.20.0" },
    });
    expect(rules(sources({ packageJson }))).toContain("airapp/sdk-pin");
  });

  it("catches a framework dependency", () => {
    const packageJson = JSON.stringify({
      scripts: { dev: "node server.js" },
      dependencies: { "busabase-sdk": "0.20.0", react: "19.0.0" },
    });
    expect(rules(sources({ packageJson }))).toContain("airapp/no-framework");
  });

  it("reports invalid JSON rather than throwing", () => {
    expect(rules(sources({ packageJson: "{ not json" }))).toContain("airapp/package-json");
  });
});

describe("browser code targets its own origin", () => {
  it("catches the obsolete bridge prefix", () => {
    const browserLogic = `${BROWSER_LOGIC}\nfetch("/__busabase_api__/v1/records");`;
    expect(rules(sources({ browserLogic }))).toContain("airapp/legacy-bridge");
  });

  it("catches a hard-coded absolute Busabase URL", () => {
    const browserLogic = BROWSER_LOGIC.replace(
      "baseUrl: window.location.origin",
      'baseUrl: "https://busabase.com"',
    );
    expect(rules(sources({ browserLogic }))).toContain("airapp/absolute-url");
  });

  it("catches an absolute asset path", () => {
    const browserLogic = `${BROWSER_LOGIC}\nimport { x } from "/js/util.js";`;
    expect(rules(sources({ browserLogic }))).toContain("airapp/absolute-asset");
  });

  it("does not flag an absolute /api/v1 call, which is not an asset", () => {
    const browserLogic = `${BROWSER_LOGIC}\nawait fetch("/api/v1/records");`;
    expect(rules(sources({ browserLogic }))).not.toContain("airapp/absolute-asset");
  });

  /**
   * The real fleet shape this rule exists for: a capped loop that still fetches
   * several pages in one call, called unconditionally at initial load. A default
   * parameter cap does not fix the "hidden behind one loading state" violation —
   * it only bounds how bad it gets. Observed shape: up to 20 pages x 100 records.
   */
  it("catches a capped loop that fetches several pages in one call", () => {
    const browserLogic = `
${BROWSER_LOGIC}
async function readAllRecords(key, { maxPages = 20 } = {}) {
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await client.records.list({ baseId, limit: 100, ...(cursor ? { cursor } : {}) });
    cursor = result.nextCursor;
    if (!cursor) break;
  }
}
`;
    expect(rules(sources({ browserLogic }))).toContain("airapp/eager-multi-page");
  });

  /** The scaffold's own shape must never trip this: one page per call, no loop. */
  it("does not flag a single-page read with no loop", () => {
    const browserLogic = `
${BROWSER_LOGIC}
const readPage = async (client, base, cursor) => {
  const page = await client.records.list({ baseId: base.baseId, limit: base.readLimit, ...(cursor ? { cursor } : {}) });
  return { records: page.records, nextCursor: page.nextCursor || null };
};
`;
    expect(rules(sources({ browserLogic }))).not.toContain("airapp/eager-multi-page");
  });

  /**
   * A `while (true)` loop with cycle detection instead of an exit-when-truthy
   * cursor check is the same unbounded shape with the condition inverted. Found
   * in the real fleet: `while (true) { … if (!nextCursor) return …; }`.
   */
  it("catches a while(true) page loop that never bounds the count", () => {
    const browserLogic = `
${BROWSER_LOGIC}
async function readAllPages(client, base) {
  let cursor;
  while (true) {
    const page = await client.records.list({ baseId: base.baseId, ...(cursor ? { cursor } : {}) });
    if (!page.nextCursor) return;
    cursor = page.nextCursor;
  }
}
`;
    expect(rules(sources({ browserLogic }))).toContain("airapp/unbounded-read");
  });

  it("does not flag an unrelated while(true) loop that reads no pages", () => {
    const browserLogic = `${BROWSER_LOGIC}\nwhile (true) { if (isReady()) break; await sleep(10); }`;
    expect(rules(sources({ browserLogic }))).not.toContain("airapp/unbounded-read");
  });

  it("catches unbounded loading", () => {
    const browserLogic = `${BROWSER_LOGIC}\nwhile (cursor) { page = await next(cursor); }`;
    expect(rules(sources({ browserLogic }))).toContain("airapp/unbounded-read");
  });
});

describe("runtime detection", () => {
  it("catches hostname sniffing", () => {
    const browserLogic = `${BROWSER_LOGIC}\nconst hosted = location.hostname !== "localhost";`;
    expect(rules(sources({ browserLogic }))).toContain("airapp/runtime-hostname");
  });

  it("catches a loopback comparison", () => {
    const browserLogic = `${BROWSER_LOGIC}\nconst local = url.includes("127.0.0.1");`;
    expect(rules(sources({ browserLogic }))).toContain("airapp/runtime-loopback");
  });

  /**
   * The guard that exists because prose about a rule was satisfying the rule — in
   * both directions. A comment may name `localhost` while explaining why no code
   * may test for it.
   */
  it("does not flag a comment that explains the hostname rule", () => {
    const browserLogic = `// Never compare against localhost: both directions are wrong.\n${BROWSER_LOGIC}`;
    const reported = rules(sources({ browserLogic }));
    expect(reported).not.toContain("airapp/runtime-hostname");
    expect(reported).not.toContain("airapp/runtime-loopback");
  });

  /**
   * An app that never branches on where it is running — always calling /api/v1 on its
   * own origin, letting its dev server proxy when standalone — has nothing to ask.
   * Requiring a probe anyway told a correctly-designed shipped template it was broken.
   */
  it("does not require a probe from an app that never branches", () => {
    const browserLogic = `
import { createBusabaseClient } from "busabase-sdk";
const client = createBusabaseClient({ baseUrl: window.location.origin });
const rows = await client.records.list({ baseId, limit: base.readLimit });
`;
    const server = 'app.get("/api/health", (c) => c.json({ ok: true }));';
    const reported = rules(sources({ browserLogic, server }));
    expect(reported).not.toContain("airapp/runtime-probe");
    expect(reported).not.toContain("airapp/runtime-env");
    expect(reported).not.toContain("airapp/runtime-route");
  });

  it("still requires one from an app that does branch", () => {
    const browserLogic = `
const runtime = await getRuntime();
if (!runtime.hosted) showConnectGate();
`;
    const server = 'app.get("/api/health", (c) => c.json({ ok: true }));';
    const reported = rules(sources({ browserLogic, server }));
    expect(reported).toContain("airapp/runtime-probe");
    expect(reported).toContain("airapp/runtime-route");
  });

  /**
   * An app that moved its probe onto the SDK no longer carries the literal path —
   * the SDK does. Treating that as "never probes" would punish the migration.
   */
  it("accepts the SDK's detectAirAppRuntime as the probe", () => {
    const browserLogic = `
import { createBusabaseClient } from "busabase-sdk";
import { detectAirAppRuntime, shouldUseLocalAirAppGateway } from "../vendor/busabase-airapp.js";
const client = createBusabaseClient({ baseUrl: window.location.origin });
export const runtime = await detectAirAppRuntime();
export const shouldUseLocalGateway = () => shouldUseLocalAirAppGateway(runtime);
`;
    expect(rules(sources({ browserLogic }))).toEqual([]);
  });

  it("still holds the host to serving the route the SDK probe asks", () => {
    const browserLogic = "export const runtime = await detectAirAppRuntime();";
    const server = 'app.get("/api/health", (c) => c.json({ ok: true }));';
    const reported = rules(sources({ browserLogic, server }));
    expect(reported).toContain("airapp/runtime-env");
    expect(reported).toContain("airapp/runtime-route");
    expect(reported).not.toContain("airapp/runtime-probe");
  });

  it("catches browser code that never probes the runtime", () => {
    const browserLogic = BROWSER_LOGIC.replace('fetch("__airapp/runtime"', 'fetch("/status"');
    expect(rules(sources({ browserLogic }))).toContain("airapp/runtime-probe");
  });

  it("catches a runtime probe with a leading slash", () => {
    const browserLogic = BROWSER_LOGIC.replace('"__airapp/runtime"', '"/__airapp/runtime"');
    expect(rules(sources({ browserLogic }))).toContain("airapp/runtime-probe-relative");
  });

  it("catches a server that stopped reading the injected variable", () => {
    const server = SERVER.replace("process.env.BUSABASE_AIRAPP_RUNTIME", '""');
    expect(rules(sources({ server }))).toContain("airapp/runtime-env");
  });

  /**
   * The comment-stripping guard on the server side: a `server.js` that only *mentions*
   * the variable in prose passed this gate once, which is how it stopped being read.
   */
  it("is not satisfied by a comment naming the variable", () => {
    const server = `// BUSABASE_AIRAPP_RUNTIME is injected by Busabase.\napp.get("/__airapp/runtime", handler);`;
    expect(rules(sources({ server }))).toContain("airapp/runtime-env");
  });

  it("catches hosting decided from a hardcoded engine list", () => {
    const server = `${SERVER}\nconst AIRAPP_HOSTED_RUNTIMES = new Set(["nodepod", "local"]);`;
    expect(rules(sources({ server }))).toContain("airapp/runtime-engine-list");
  });

  it("catches a server that does not serve the endpoint", () => {
    const server = SERVER.replace('"/__airapp/runtime"', '"/health"');
    expect(rules(sources({ server }))).toContain("airapp/runtime-route");
  });

  /**
   * An app that calls the SDK helper cannot hand-write the `hosted` line at all,
   * which is the line that has regressed twice. The rule has to recognise it.
   */
  it("accepts a host that uses the SDK's describeBusabaseAirAppRuntime", () => {
    const server = `
import { describeBusabaseAirAppRuntime } from "busabase-sdk/airapp-node";
app.get("/__airapp/runtime", (c) => c.json(describeBusabaseAirAppRuntime()));
`;
    expect(rules(sources({ server }))).toEqual([]);
  });

  it("accepts a Python host reading the variable directly", () => {
    const server = `import os\nRUNTIME = os.environ.get("BUSABASE_AIRAPP_RUNTIME", "")\nroutes = {"/__airapp/runtime": handler}\n`;
    expect(rules(sources({ server, serverLanguage: "python" }))).toEqual([]);
  });
});

describe("credentials", () => {
  it("catches an API key reference in anything the browser downloads", () => {
    const browserDownloads = `${BROWSER_DOWNLOADS}\nconst k = BUSABASE_API_KEY;`;
    expect(rules(sources({ browserDownloads }))).toContain("airapp/credential");
  });

  /**
   * The wider corpus matters: a key in a string table ships to the browser exactly
   * like one in app.js, and used to pass a gate that only read the logic files.
   */
  it("catches a literal token pasted into a string table", () => {
    const browserDownloads = `${BROWSER_DOWNLOADS}\nexport const messages = { auth: "Bearer sk0000111122223333" };`;
    expect(rules(sources({ browserDownloads }))).toContain("airapp/credential");
  });

  it("catches browser code building an Authorization header at all", () => {
    const browserDownloads = `${BROWSER_DOWNLOADS}\nheaders.authorization = \`Bearer \${token}\`;`;
    expect(rules(sources({ browserDownloads }))).toContain("airapp/credential");
  });

  /**
   * Comments are deliberately NOT stripped here — a key commented out still ships to
   * the browser verbatim. So the patterns have to be precise instead: this exact
   * comment made a real app fail against a rule that matched the bare word.
   */
  it("does not flag a comment that merely names a bearer token", () => {
    const browserDownloads = `${BROWSER_DOWNLOADS}\n// base_url + bearer token (the proxy injects the AirApp's own)`;
    expect(rules(sources({ browserDownloads }))).not.toContain("airapp/credential");
  });

  it("still flags a key that was only commented out", () => {
    const browserDownloads = `${BROWSER_DOWNLOADS}\n// const key = BUSABASE_API_KEY;`;
    expect(rules(sources({ browserDownloads }))).toContain("airapp/credential");
  });

  it("catches a literal Bearer token in the server", () => {
    const server = `${SERVER}\nheaders.set("authorization", "Bearer abcd1234efgh");`;
    expect(rules(sources({ server }))).toContain("airapp/credential");
  });

  it("allows the server to interpolate one from the environment", () => {
    const server = `${SERVER}\nheaders.set("authorization", \`Bearer \${process.env.TOKEN}\`);`;
    expect(rules(sources({ server }))).not.toContain("airapp/credential");
  });
});

describe("the app's own map of the workspace", () => {
  it("catches a resourceKey that is not the shipped slug", () => {
    const config = CONFIG.replace('resourceKey: "my-desk-app"', 'resourceKey: "other"');
    expect(rules(sources({ config }))).toContain("airapp/resource-key");
  });

  /**
   * The regression this exists for: stripping workspace ids out of config took the
   * Base slug with them, and only the app's own provisioning door broke.
   */
  it("catches a config Base left without a slug", () => {
    const config = CONFIG.replace(' slug: "my-desk-reviews",', "");
    expect(rules(sources({ config }))).toContain("airapp/base-slug");
  });

  it("catches a drive left without a slug", () => {
    const config = CONFIG.replace('drive: { slug: "my-desk-files", ', "drive: { ");
    expect(rules(sources({ config }))).toContain("airapp/base-slug");
  });

  it("warns about a page budget above the documented default", () => {
    const config = CONFIG.replace("readLimit: 50", "readLimit: 500");
    expect(rules(sources({ config }), "warning")).toContain("airapp/read-budget");
  });

  it("errors on a non-positive page budget", () => {
    const config = CONFIG.replace("readLimit: 50", "readLimit: 0");
    expect(rules(sources({ config }))).toContain("airapp/read-budget");
  });

  it("catches a Vault value carried in config", () => {
    const config = `${CONFIG}\nexport const secrets = { vaultValue: "hunter2" };`;
    expect(rules(sources({ config }))).toContain("airapp/vault-value");
  });
});

describe("scanAirAppConfig", () => {
  it("does not mistake a nested object for a Base", () => {
    const scanned = scanAirAppConfig(
      'const c = { bases: [{ key: "a", slug: "x-a", fields: [{ slug: "note" }] }] };',
    );
    expect(scanned.bases).toEqual([{ key: "a", slug: "x-a" }]);
  });

  it("reads the resourceKey out of the airApp block", () => {
    expect(scanAirAppConfig(CONFIG).resourceKey).toBe("my-desk-app");
  });
});

describe("stripComments", () => {
  it("removes line and block comments", () => {
    expect(stripComments("a // gone\n/* also gone */ b").replace(/\s+/g, " ").trim()).toBe("a b");
  });

  it("leaves a protocol-relative URL alone", () => {
    expect(stripComments('const u = "https://example.com";')).toContain("https://example.com");
  });
});

// The two halves of busabase/templates#38, verbatim from busa-crm's provider: the
// upsert as it shipped before the fix (review forced from where the app runs),
// and as it ships now (`autoMerge` left to the person's permission).
const UPSERT_BEFORE_FIX = `
import { isStandaloneLocalRuntime } from "../runtime.js";
async function upsert(key, idFieldSlug, idValue, fields, message) {
  const declared = base(key);
  const existing = await findRecord(key, idFieldSlug, idValue);
  const normalized = toBusabaseFields(fields);
  const autoMerge = isStandaloneLocalRuntime();
  if (!existing) {
    return runtimeClient.bases.createChangeRequest({
      baseId: declared.baseId,
      fields: normalized,
      message,
      submittedBy: appConfig.appId,
      autoMerge,
    });
  }
  return runtimeClient.records.changeRequest({
    recordId: existing.id,
    operation: "update",
    fields: normalized,
    message,
    author: appConfig.appId,
    baseCommitId: existing.headCommitId,
    autoMerge,
  });
}
`;

const UPSERT_AFTER_FIX = `
// A person's write from this app leaves \`autoMerge\` unset, so Busabase decides
// from that person's own permission.
const isQueued = (result) => result?.materialized === false || result?.status === "in_review";
async function upsert(key, idFieldSlug, idValue, fields, message) {
  const declared = base(key);
  const existing = await findRecord(key, idFieldSlug, idValue);
  const normalized = toBusabaseFields(fields);
  if (!existing) {
    return runtimeClient.bases.createChangeRequest({
      baseId: declared.baseId,
      fields: normalized,
      message,
      submittedBy: appConfig.appId,
    });
  }
  return runtimeClient.records.changeRequest({
    recordId: existing.id,
    operation: "update",
    fields: normalized,
    message,
    author: appConfig.appId,
    baseCommitId: existing.headCommitId,
  });
}
`;

const lines = (source: string) => findForcedReview(source).map((finding) => finding.line);

describe("airapp/forced-review", () => {
  it("fails the provider as it shipped before busabase/templates#38", () => {
    // Red half of the control: the derived value, then both pass-throughs.
    expect(lines(UPSERT_BEFORE_FIX)).toEqual([7, 14, 24]);
    const provider = `${BROWSER_LOGIC}\n${UPSERT_BEFORE_FIX}`;
    expect(rules(sources({ browserLogic: provider }))).toEqual([
      "airapp/forced-review",
      "airapp/forced-review",
      "airapp/forced-review",
    ]);
  });

  it("passes the same provider once autoMerge is left unset", () => {
    // Green half: same sources, the one difference being the fix.
    expect(lines(UPSERT_AFTER_FIX)).toEqual([]);
    expect(rules(sources({ browserLogic: `${BROWSER_LOGIC}\n${UPSERT_AFTER_FIX}` }))).toEqual([]);
  });

  it("flags an explicit false and a value worked out at runtime", () => {
    expect(lines("client.records.changeRequest({ recordId, autoMerge: false });")).toEqual([1]);
    expect(lines("let written = { autoMerge: false };")).toEqual([1]);
    const source = [
      "const autoMerge = isStandaloneLocalRuntime();",
      "await client.bases.createChangeRequest({ baseId, fields, autoMerge });",
      "await client.records.changeRequest({ recordId, autoMerge: isStandaloneLocalRuntime() });",
      "const merge = { autoMerge: !isAirAppRequest() };",
    ].join("\n");
    expect(lines(source)).toEqual([1, 2, 3, 4]);
  });

  it("lets an omitted or literal-true autoMerge through", () => {
    expect(lines("await client.records.changeRequest({ recordId, fields });")).toEqual([]);
    expect(
      lines("await client.nodes.createChangeRequest({ operations, autoMerge: true });"),
    ).toEqual([]);
  });

  it("ignores the word in comments, strings, template text and regexes", () => {
    const source = [
      "// autoMerge is omitted: the workspace's permissions decide.",
      "/* never pass autoMerge: false here */",
      'const hint = "pass autoMerge: false to force review";',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture IS a template literal.
      "const label = `autoMerge = ${String(flag)}`;",
      "const rule = /autoMerge:\\s*false/;",
      "const ok = rule.test(source); // autoMerge: false",
    ].join("\n");
    expect(lines(source)).toEqual([]);
    // An interpolation is code, so a real use inside one still counts.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture IS a template literal.
    expect(codeOnly("const label = `x ${autoMerge} y`;")).toMatch(/autoMerge/);
  });

  it("accepts forced review only with a stated reason", () => {
    const reason = "drafts an outgoing contract that legal must approve before it is sent";
    expect(lines(`autoMerge: false, // allow-forced-review: ${reason}`)).toEqual([]);
    expect(lines(`// allow-forced-review: ${reason}\nautoMerge: false,`)).toEqual([]);
    const bare = findForcedReview("autoMerge: false, // allow-forced-review: risky");
    expect(bare).toHaveLength(1);
    expect(bare[0].problem).toMatch(/reason of at least/);
  });

  it("scans the app's own files, not vendored bundles, tests or dev scripts", () => {
    const appSources = [
      {
        path: "app/js/providers/busabase-provider.js",
        content: "export const save = (c) => c.records.changeRequest({ autoMerge: false });\n",
      },
      { path: "app/vendor/busabase-airapp.js", content: "publish({ autoMerge: false });\n" },
      { path: "test/provider.test.mjs", content: "assert.equal(input.autoMerge, false);\n" },
      { path: "scripts/check.mjs", content: "if (source.autoMerge === false) fail();\n" },
      { path: "app/js/model.test.js", content: "expect({ autoMerge: false });\n" },
      { path: "app/i18n/messages.json", content: '{ "autoMerge": false }\n' },
      { path: "lib/client.ts", content: "const autoMerge = !isAirAppRequest();\n" },
    ];
    const messages = checkAirApp({ appSources })
      .filter((finding) => finding.rule === "airapp/forced-review")
      .map((finding) => finding.message.split(": ")[0]);
    expect(messages).toEqual(["app/js/providers/busabase-provider.js:1", "lib/client.ts:1"]);
  });

  it("prefers per-file sources over the concatenated corpora, never both", () => {
    // A caller handing both must not get every finding twice.
    const findings = checkAirApp({
      browserLogic: UPSERT_BEFORE_FIX,
      appSources: [{ path: "app/js/providers/busabase-provider.js", content: UPSERT_BEFORE_FIX }],
    }).filter((finding) => finding.rule === "airapp/forced-review");
    expect(findings).toHaveLength(3);
    expect(findings[0].message).toMatch(/^app\/js\/providers\/busabase-provider\.js:7: /);
  });

  it("classifies paths the way busabase/templates' check-app-writes does", () => {
    expect(isAirAppWriteRuleSource("server.js")).toBe(true);
    expect(isAirAppWriteRuleSource("server/hono.ts")).toBe(true);
    expect(isAirAppWriteRuleSource("app/js/app.js")).toBe(true);
    expect(isAirAppWriteRuleSource("app/vendor/busabase-sdk.js")).toBe(false);
    expect(isAirAppWriteRuleSource("node_modules/x/index.js")).toBe(false);
    expect(isAirAppWriteRuleSource("tests/a.mjs")).toBe(false);
    expect(isAirAppWriteRuleSource("app/js/a.test.ts")).toBe(false);
    expect(isAirAppWriteRuleSource("app/index.html")).toBe(false);
  });
});
