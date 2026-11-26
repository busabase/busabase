// @vitest-environment jsdom

/**
 * Which node types the Share dialog offers "share to web" for.
 *
 * Nothing rendered this dialog under test before, which is how a whole half of
 * it stayed invisible for AirApp: the switch is gated on
 * `publicAccessOf(nodeType) !== "no"`, and AirApp's registry entry said `"no"`
 * for three weeks after the runtime it was waiting for shipped (#6648). The
 * server-side gate (`resolvePublicTargetNode`) reads the same flag, so the user
 * saw no Share-to-web switch AND a link would have 404'd anyway — two symptoms,
 * one value. `packages/busabase-contract/src/domains/registry.test.ts` pins the
 * value; this pins the thing the user actually sees, so the two cannot drift
 * apart again.
 *
 * The fake `orpc` answers every query with a fixture (or `null`) and every
 * mutation with `{}`: the dialog's own copy and gating are under test, not the
 * network.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { listNodeTypes, publicAccessOf } from "busabase-contract/domains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeShareDialog } from "./node-share-button";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,dGVzdA==") },
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof globalThis.matchMedia;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const FIXTURES: Record<string, unknown> = {
  "nodes.share.get": {
    scope: "none",
    capability: "read",
    hasPassword: false,
    password: null,
    expiresAt: null,
  },
  "embedLinks.list": [],
};

/** Every mutation the dialog fired, in order, as `{ path, input }`. */
const MUTATIONS: Array<{ path: string; input: unknown }> = [];
/**
 * Optional per-procedure server stand-ins, run on each mutation — lets a test
 * make `nodes.share.set` change what the next `nodes.share.get` returns.
 */
const MUTATION_HANDLERS: Record<string, (input: never) => void> = {};

/** A `BusabaseQueryUtils` stand-in: any `a.b.c.queryOptions()` resolves to a fixture. */
const fakeOrpc = (): BusabaseQueryUtils => {
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key: string) => {
        if (key === "queryOptions") {
          return (options?: { input?: unknown }) => ({
            queryKey: [...path, options?.input ?? null],
            queryFn: async () => FIXTURES[path.join(".")] ?? null,
          });
        }
        if (key === "key") return () => path;
        if (key === "mutationOptions") {
          return () => ({
            mutationFn: async (input: unknown) => {
              const name = path.join(".");
              MUTATIONS.push({ path: name, input });
              MUTATION_HANDLERS[name]?.(input as never);
              return {};
            },
          });
        }
        return node([...path, key]);
      },
    });
  return node([]) as BusabaseQueryUtils;
};

const renderDialog = (nodeType: string, nodeSlug = "thing") =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <NodeShareDialog
        nodeId="nod_1"
        nodeName="Thing"
        nodeSlug={nodeSlug}
        nodeType={nodeType}
        onOpenChange={() => {}}
        open
        orpc={fakeOrpc()}
        spaceId="org_1"
      />
    </QueryClientProvider>,
  );

const shareToWebSwitch = () => document.getElementById("node-share-public");

afterEach(cleanup);

describe("NodeShareDialog: share-to-web availability follows the registry", () => {
  it("offers share-to-web for an AirApp, with the copy that says it RUNS the app", async () => {
    renderDialog("airapp");

    await waitFor(() => expect(shareToWebSwitch()).not.toBeNull());
    // An AirApp is a program: the hint must say the visitor's browser runs it,
    // not the generic "anyone with the link can open this".
    expect(screen.getByText(/run/i, { selector: "span.text-xs" })).toBeTruthy();
  });

  it.each(["html", "drive", "skill"])(
    "offers share-to-web for %s through its read-only public detail",
    async (type) => {
      renderDialog(type);

      expect(publicAccessOf(type)).toBe("detail");
      await waitFor(() => expect(shareToWebSwitch()).not.toBeNull());
    },
  );

  it("does not offer sharing for an unknown plugin node type", () => {
    const unknownType = "undecided-plugin-node";
    expect(publicAccessOf(unknownType)).toBe("no");
    renderDialog(unknownType);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shareToWebSwitch()).toBeNull();
  });

  it("agrees with publicAccessOf for every built-in node type", async () => {
    // Data-driven so a newly added type cannot ship with the switch and the
    // resolver disagreeing. Types that share to web must show the switch; types
    // that cannot must not.
    for (const { type } of listNodeTypes()) {
      const { unmount } = renderDialog(type);
      const offered = publicAccessOf(type) !== "no";

      if (offered) {
        await waitFor(() => expect(shareToWebSwitch(), type).not.toBeNull());
      } else {
        // may render only the embed half, or nothing at all — either way, no switch.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(shareToWebSwitch(), type).toBeNull();
      }
      unmount();
      cleanup();
    }
  });
});

describe("NodeShareDialog: a node made public by a shared ancestor", () => {
  const sharedRow = (nodeId: string, name: string) => ({
    nodeId,
    name,
    slug: `${nodeId}-slug`,
    type: "folder",
    icon: null,
    capability: "read",
    hasPassword: false,
    expiresAt: null,
    createdAt: "2026-09-30T00:00:00.000Z",
  });

  afterEach(() => {
    delete FIXTURES["nodes.ancestors"];
    delete FIXTURES["nodes.share.list"];
  });

  it("says it is public via the NEAREST shared ancestor instead of 'Restricted'", async () => {
    // Root-first: the grandparent and the parent are both shared; the parent
    // is nearer, so it is the share that actually gates this node.
    FIXTURES["nodes.ancestors"] = { ancestorIds: ["nod_root", "nod_grand", "nod_parent"] };
    FIXTURES["nodes.share.list"] = [
      sharedRow("nod_grand", "Grand Folder"),
      sharedRow("nod_parent", "Parent Folder"),
    ];
    renderDialog("doc");

    await waitFor(() => expect(screen.getByTestId("node-share-inherited")).toBeTruthy());
    expect(screen.getByTestId("node-share-inherited").textContent).toContain("Parent Folder");
    expect(screen.getByTestId("node-share-inherited").textContent).not.toContain("Grand Folder");
    // No own-share switch to flip, but the link that already works is offered.
    expect(shareToWebSwitch()).toBeNull();
    expect(screen.getByTestId("node-share-public-url")).toBeTruthy();
    expect(screen.getByTestId("node-share-open-ancestor").textContent).toContain("Parent Folder");
  });

  it("keeps the ordinary switch when no ancestor is shared", async () => {
    FIXTURES["nodes.ancestors"] = { ancestorIds: ["nod_root", "nod_parent"] };
    FIXTURES["nodes.share.list"] = [sharedRow("nod_elsewhere", "Unrelated Folder")];
    renderDialog("doc");

    await waitFor(() => expect(shareToWebSwitch()).not.toBeNull());
    expect(screen.queryByTestId("node-share-inherited")).toBeNull();
  });
});

describe("NodeShareDialog: public QR link", () => {
  afterEach(() => {
    FIXTURES["nodes.share.get"] = {
      scope: "none",
      capability: "read",
      hasPassword: false,
      expiresAt: null,
    };
  });

  it("shows a QR only for an active public link and encodes the displayed URL", async () => {
    renderDialog("base");
    await waitFor(() => expect(shareToWebSwitch()).not.toBeNull());
    expect(screen.queryByRole("button", { name: "QR code" })).toBeNull();
    cleanup();

    FIXTURES["nodes.share.get"] = {
      scope: "public",
      capability: "read",
      hasPassword: false,
      expiresAt: null,
    };
    renderDialog("base");
    const qrButton = await screen.findByRole("button", { name: "QR code" });
    fireEvent.click(qrButton);
    expect(await screen.findByAltText("QR code for this link")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download PNG" })).toBeTruthy();
    const { default: QRCode } = await import("qrcode");
    expect(QRCode.toDataURL).toHaveBeenCalledWith(
      (screen.getByTestId("node-share-public-url") as HTMLInputElement).value,
      expect.objectContaining({ width: 512, margin: 4 }),
    );
  });

  it.each(listNodeTypes().filter(({ type }) => publicAccessOf(type) !== "no"))(
    "offers a QR for a public $type node",
    async ({ type }) => {
      FIXTURES["nodes.share.get"] = {
        scope: "public",
        capability: "read",
        hasPassword: false,
        expiresAt: null,
      };
      renderDialog(type);
      expect(await screen.findByRole("button", { name: "QR code" })).toBeTruthy();
    },
  );

  it("hides the QR for an expired public grant", async () => {
    FIXTURES["nodes.share.get"] = {
      scope: "public",
      capability: "read",
      hasPassword: false,
      expiresAt: "2020-01-01T00:00:00.000Z",
    };
    renderDialog("base");
    await waitFor(() => expect(shareToWebSwitch()?.getAttribute("data-state")).toBe("unchecked"));
    expect(screen.queryByRole("button", { name: "QR code" })).toBeNull();
  });

  it("keeps a Base share URL stable when its slug changes", async () => {
    FIXTURES["nodes.share.get"] = {
      scope: "public",
      capability: "read",
      hasPassword: false,
      expiresAt: null,
    };
    const first = renderDialog("base", "original-name");
    const firstUrl = ((await screen.findByTestId("node-share-public-url")) as HTMLInputElement)
      .value;
    expect(firstUrl).toContain("/base/nod_1");
    first.unmount();
    cleanup();

    renderDialog("base", "renamed-base");
    const renamedUrl = ((await screen.findByTestId("node-share-public-url")) as HTMLInputElement)
      .value;
    expect(renamedUrl).toBe(firstUrl);
  });
});

describe("NodeShareDialog: link password", () => {
  const publicShare = (password: { hasPassword: boolean; password: string | null }) => ({
    nodeId: "nod_1",
    scope: "public",
    capability: "read",
    expiresAt: null,
    updatedAt: "2026-11-25T00:00:00.000Z",
    ...password,
  });
  const passwordSwitch = () => screen.getByTestId("node-share-password-switch");
  const shareSetInputs = () =>
    MUTATIONS.filter((call) => call.path === "nodes.share.set").map((call) => call.input);
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    MUTATIONS.length = 0;
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    // Behave like the server: a set password is returned to the manager.
    MUTATION_HANDLERS["nodes.share.set"] = (input: { password?: string | null }) => {
      if (input.password === undefined) return;
      FIXTURES["nodes.share.get"] = publicShare({
        hasPassword: input.password !== null,
        password: input.password,
      });
    };
  });

  afterEach(() => {
    delete MUTATION_HANDLERS["nodes.share.set"];
    FIXTURES["nodes.share.get"] = {
      scope: "none",
      capability: "read",
      hasPassword: false,
      password: null,
      expiresAt: null,
    };
  });

  it("is off without a password, and switching it on generates and shows a 6-digit code", async () => {
    FIXTURES["nodes.share.get"] = publicShare({ hasPassword: false, password: null });
    renderDialog("doc");

    await waitFor(() => expect(passwordSwitch().getAttribute("data-state")).toBe("unchecked"));
    expect(screen.queryByTestId("node-share-password-value")).toBeNull();

    fireEvent.click(passwordSwitch());

    await waitFor(() => expect(shareSetInputs()).toHaveLength(1));
    const sent = shareSetInputs()[0] as { nodeId: string; scope: string; password: string };
    expect(sent).toMatchObject({ nodeId: "nod_1", scope: "public" });
    expect(sent.password).toMatch(/^\d{6}$/);
    const shown = await screen.findByTestId("node-share-password-value");
    expect(shown.textContent).toBe(sent.password);
    expect(passwordSwitch().getAttribute("data-state")).toBe("checked");
  });

  it("copies the link and the password together, labelled, with a copied state", async () => {
    FIXTURES["nodes.share.get"] = publicShare({ hasPassword: true, password: "482913" });
    renderDialog("doc");

    expect((await screen.findByTestId("node-share-password-value")).textContent).toBe("482913");
    const url = (screen.getByTestId("node-share-public-url") as HTMLInputElement).value;
    fireEvent.click(screen.getByTestId("node-share-copy-link-and-password"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`Link: ${url}\nPassword: 482913`));
    // The URL itself never carries the password.
    expect(url).not.toContain("482913");
    await waitFor(() =>
      expect(
        screen.getByTestId("node-share-copy-link-and-password").querySelector(".lucide-check"),
      ).not.toBeNull(),
    );
  });

  it("changes the password through an inline editor that refuses fewer than 4 or more than 64 characters", async () => {
    FIXTURES["nodes.share.get"] = publicShare({ hasPassword: true, password: "482913" });
    renderDialog("doc");

    fireEvent.click(await screen.findByTestId("node-share-password-edit"));
    const input = screen.getByTestId("node-share-password-input") as HTMLInputElement;
    expect(input.value).toBe("482913");
    const save = () => screen.getByTestId("node-share-password-save") as HTMLButtonElement;

    fireEvent.change(input, { target: { value: "abc" } });
    expect(save().disabled).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "x".repeat(65) } });
    expect(save().disabled).toBe(true);

    fireEvent.change(input, { target: { value: "river-otter" } });
    expect(save().disabled).toBe(false);
    expect(input.getAttribute("aria-invalid")).toBe("false");
    fireEvent.click(save());

    await waitFor(() =>
      expect(shareSetInputs()).toEqual([
        { nodeId: "nod_1", scope: "public", password: "river-otter" },
      ]),
    );
    expect((await screen.findByTestId("node-share-password-value")).textContent).toBe(
      "river-otter",
    );
    expect(screen.queryByTestId("node-share-password-input")).toBeNull();
  });

  it("cancelling the editor sends nothing and keeps the current password", async () => {
    FIXTURES["nodes.share.get"] = publicShare({ hasPassword: true, password: "482913" });
    renderDialog("doc");

    fireEvent.click(await screen.findByTestId("node-share-password-edit"));
    fireEvent.change(screen.getByTestId("node-share-password-input"), {
      target: { value: "something-else" },
    });
    fireEvent.click(screen.getByTestId("node-share-password-cancel"));

    expect(screen.getByTestId("node-share-password-value").textContent).toBe("482913");
    expect(shareSetInputs()).toEqual([]);
  });

  it("explains a password that cannot be shown, which can only be replaced", async () => {
    FIXTURES["nodes.share.get"] = publicShare({ hasPassword: true, password: null });
    renderDialog("doc");

    await waitFor(() => expect(passwordSwitch().getAttribute("data-state")).toBe("checked"));
    expect(screen.getByTestId("node-share-password-legacy").textContent).toContain(
      "can't be shown",
    );
    expect(screen.queryByTestId("node-share-password-value")).toBeNull();
    expect(screen.queryByTestId("node-share-copy-link-and-password")).toBeNull();

    fireEvent.click(screen.getByTestId("node-share-password-edit"));
    expect((screen.getByTestId("node-share-password-input") as HTMLInputElement).value).toBe("");
  });

  it("switching it off removes the password", async () => {
    FIXTURES["nodes.share.get"] = publicShare({ hasPassword: true, password: "482913" });
    renderDialog("doc");

    await screen.findByTestId("node-share-password-value");
    fireEvent.click(passwordSwitch());

    await waitFor(() =>
      expect(shareSetInputs()).toEqual([{ nodeId: "nod_1", scope: "public", password: null }]),
    );
    await waitFor(() => expect(passwordSwitch().getAttribute("data-state")).toBe("unchecked"));
    expect(screen.queryByTestId("node-share-password-value")).toBeNull();
  });
});
