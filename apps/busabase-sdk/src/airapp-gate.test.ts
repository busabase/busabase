import { describe, expect, it } from "vitest";
import { AirAppSetupError } from "./airapp.js";
import {
  type BusabaseAirAppAuthStatus,
  defaultAirAppGateRenderer,
  describeAirAppSetupError,
  escapeHtml,
  selectAirAppGateScreen,
} from "./airapp-gate.js";

const status = (overrides: Partial<BusabaseAirAppAuthStatus>): BusabaseAirAppAuthStatus =>
  ({
    connected: true,
    cloudBaseUrl: "https://busabase.com",
    readiness: "ready",
    action: "continue",
    ...overrides,
  }) as BusabaseAirAppAuthStatus;

describe("selectAirAppGateScreen", () => {
  it.each([
    ["needs_connection", "connect"],
    ["needs_auth", "connect"],
    ["needs_space", "space"],
    ["ready", "ready"],
  ] as const)("maps readiness %s to the %s screen", (readiness, screen) => {
    expect(selectAirAppGateScreen(status({ readiness }))).toBe(screen);
  });

  it("gates when there is no status at all", () => {
    expect(selectAirAppGateScreen(null)).toBe("connect");
    expect(selectAirAppGateScreen(undefined)).toBe("connect");
  });

  it("falls back to connected/requiresSpace for a server predating `readiness`", () => {
    // An app may upgrade the SDK before the server it talks to; reading only
    // `readiness` would send every such app to the connect screen forever.
    const legacy = (extra: object) => ({ cloudBaseUrl: "", ...extra }) as BusabaseAirAppAuthStatus;
    expect(selectAirAppGateScreen(legacy({ connected: false }))).toBe("connect");
    expect(selectAirAppGateScreen(legacy({ connected: true, requiresSpace: true }))).toBe("space");
    expect(selectAirAppGateScreen(legacy({ connected: true, requiresSpace: false }))).toBe("ready");
  });

  it("prefers readiness over the legacy pair when both are present", () => {
    expect(
      selectAirAppGateScreen(
        status({ readiness: "needs_space", connected: true, requiresSpace: false }),
      ),
    ).toBe("space");
  });
});

describe("describeAirAppSetupError", () => {
  it("reads the code off an AirAppSetupError", () => {
    const described = describeAirAppSetupError(
      new AirAppSetupError("SETUP_PENDING", "awaiting approval"),
    );
    expect(described).toMatchObject({
      code: "SETUP_PENDING",
      detail: "awaiting approval",
      canProvision: false,
      canRetry: true,
    });
  });

  it("parses the historical `CODE: detail` message shape from a plain Error", () => {
    const described = describeAirAppSetupError(new Error("SETUP_CONFLICT: folder is not ours"));
    expect(described.code).toBe("SETUP_CONFLICT");
    expect(described.detail).toBe("folder is not ours");
    expect(described.canProvision).toBe(false);
    expect(described.canRetry).toBe(false);
  });

  it("accepts a bare string", () => {
    expect(describeAirAppSetupError("SETUP_REQUIRED").canProvision).toBe(true);
  });

  it("offers initialization only for SETUP_REQUIRED", () => {
    for (const code of [
      "SETUP_PENDING",
      "SETUP_CONFLICT",
      "SETUP_PERMISSION",
      "SCHEMA_INCOMPLETE",
    ]) {
      expect(describeAirAppSetupError(`${code}: x`).canProvision).toBe(false);
    }
    expect(describeAirAppSetupError("SETUP_REQUIRED: x").canProvision).toBe(true);
  });

  it("offers a retry only where retrying can change the answer", () => {
    // A conflict or a permission failure does not resolve itself; offering
    // "Check again" there trains the operator to mash a button that cannot work.
    expect(describeAirAppSetupError("SETUP_PENDING: x").canRetry).toBe(true);
    expect(describeAirAppSetupError("SCHEMA_INCOMPLETE: x").canRetry).toBe(true);
    expect(describeAirAppSetupError("SETUP_CONFLICT: x").canRetry).toBe(false);
    expect(describeAirAppSetupError("SETUP_PERMISSION: x").canRetry).toBe(false);
  });

  it("keeps a multi-line detail intact", () => {
    expect(describeAirAppSetupError("SETUP_CONFLICT: line one\nline two").detail).toBe(
      "line one\nline two",
    );
  });

  it("degrades to SETUP_REQUIRED rather than throwing on junk", () => {
    expect(describeAirAppSetupError(undefined).code).toBe("SETUP_REQUIRED");
    expect(describeAirAppSetupError(null).code).toBe("SETUP_REQUIRED");
  });
});

describe("escapeHtml", () => {
  it("neutralizes every character that can break out of markup or an attribute", () => {
    expect(escapeHtml(`<script>"'&`)).toBe("&lt;script&gt;&quot;&#039;&amp;");
  });

  it("escapes the ampersand first, so escapes are not double-encoded into entities", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("defaultAirAppGateRenderer — connect screen", () => {
  const view = {
    appName: "Kelly CRM",
    cloudBaseUrl: "https://busabase.com",
    reconnect: false,
    oauthError: "",
    authBasePath: "",
  };

  it("posts to the gateway's own start route so connecting needs no JavaScript", () => {
    const html = defaultAirAppGateRenderer.connect(view);
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/auth/start"');
  });

  it("honours an authBasePath for sub-path hosting", () => {
    const html = defaultAirAppGateRenderer.connect({ ...view, authBasePath: "/apps/crm" });
    expect(html).toContain('action="/apps/crm/auth/start"');
  });

  it("shows the app name and the cloud host", () => {
    const html = defaultAirAppGateRenderer.connect(view);
    expect(html).toContain("Kelly CRM reads and writes");
    expect(html).toContain("busabase.com");
  });

  it("escapes an oauth_error echoed back from the callback redirect", () => {
    // This string arrives from the URL query, so it is attacker-controllable on
    // a machine where the operator can be induced to open a crafted link.
    const html = defaultAirAppGateRenderer.connect({
      ...view,
      oauthError: `<img src=x onerror="alert(1)">`,
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("escapes the app name", () => {
    const html = defaultAirAppGateRenderer.connect({
      ...view,
      appName: `</p><script>x()</script>`,
    });
    expect(html).not.toContain("<script>");
  });

  it("only mentions the expired session when reconnecting", () => {
    expect(defaultAirAppGateRenderer.connect(view)).not.toContain("session expired");
    expect(defaultAirAppGateRenderer.connect({ ...view, reconnect: true })).toContain(
      "session expired",
    );
  });

  it("never offers an API key field — connecting is OAuth or nothing", () => {
    const html = defaultAirAppGateRenderer.connect(view).toLowerCase();
    expect(html).not.toContain("api key");
    expect(html).not.toContain("api_key");
    expect(html).not.toContain("device code");
  });
});

describe("defaultAirAppGateRenderer — space screen", () => {
  const view = {
    appName: "Kelly CRM",
    baseUrl: "https://busabase.com",
    spaces: [
      { id: "spc_1", name: "Acme" },
      { id: "spc_2", name: "Beta" },
    ],
  };

  it("renders one option per Space, labelled with name and id", () => {
    const html = defaultAirAppGateRenderer.space(view);
    expect(html).toContain('<option value="spc_1">Acme · spc_1</option>');
    expect(html).toContain('<option value="spc_2">Beta · spc_2</option>');
  });

  it("escapes a Space name, which is operator-supplied on the server", () => {
    const html = defaultAirAppGateRenderer.space({
      ...view,
      spaces: [{ id: "spc_1", name: `</option><script>x()</script>` }],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;/option&gt;");
  });

  it("renders an empty, still-valid select when the account has no Spaces", () => {
    const html = defaultAirAppGateRenderer.space({ ...view, spaces: [] });
    expect(html).toContain("<select");
    expect(html).not.toContain("<option");
  });
});

describe("defaultAirAppGateRenderer — workspace screen", () => {
  const base = { appName: "Kelly CRM", demoHref: "?demo=1" };

  it("offers initialization for SETUP_REQUIRED", () => {
    const html = defaultAirAppGateRenderer.workspace({
      ...base,
      ...describeAirAppSetupError("SETUP_REQUIRED: contacts"),
    });
    expect(html).toContain("data-provision");
    expect(html).not.toContain("data-retry");
    expect(html).toContain("Initialize the Busabase workspace");
  });

  it("offers only a retry while approval is pending", () => {
    const html = defaultAirAppGateRenderer.workspace({
      ...base,
      ...describeAirAppSetupError("SETUP_PENDING: cr-9 awaits approval"),
    });
    expect(html).toContain("data-retry");
    expect(html).not.toContain("data-provision");
    expect(html).toContain("cr-9 awaits approval");
  });

  it("offers neither button for a conflict, and shows why", () => {
    const html = defaultAirAppGateRenderer.workspace({
      ...base,
      ...describeAirAppSetupError("SETUP_CONFLICT: the Folder is not ours"),
    });
    expect(html).not.toContain("data-retry");
    expect(html).not.toContain("data-provision");
    expect(html).toContain("the Folder is not ours");
  });

  it("escapes the failure detail, which can carry a server-supplied slug", () => {
    const html = defaultAirAppGateRenderer.workspace({
      ...base,
      ...describeAirAppSetupError(`SETUP_CONFLICT: <img src=x onerror="alert(1)">`),
    });
    expect(html).not.toContain("<img");
  });

  it("hides the demo escape hatch when the app has no demo", () => {
    const html = defaultAirAppGateRenderer.workspace({
      ...base,
      demoHref: null,
      ...describeAirAppSetupError("SETUP_CONFLICT: x"),
    });
    expect(html).not.toContain("read-only demo");
  });

  it("promises the change is additive, which is what makes it safe to click", () => {
    const html = defaultAirAppGateRenderer.workspace({
      ...base,
      ...describeAirAppSetupError("SETUP_REQUIRED: contacts"),
    });
    expect(html).toContain("nothing existing is deleted or repurposed");
  });
});
