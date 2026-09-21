import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { DashboardVisitorProvider } from "../visitor-context";
import { AssetDetailView } from "./assets";
import { SubmitPermissionProvider } from "./split-submit-button";

Object.assign(globalThis, { React });

/**
 * `assets.delete` is `node("write")`, the same level as the two cards below it
 * on this page. Its button carried no permission gate at all — only a
 * `disabled` on "still referenced somewhere", which made it LOOK safe on every
 * asset that happened to be in use. On an unused asset a Cloud viewer was shown
 * an enabled, destructive button that could only 403.
 *
 * Found by the acceptance run, not by typecheck: the control renders fine, it
 * just renders for the wrong person.
 */
const ASSET = {
  id: "ast_1",
  name: "policy.md",
  fileName: "policy.md",
  mimeType: "text/plain",
  size: 53,
  url: "/files/policy.md",
  contentKind: "text",
  contentHash: "sha256:abc",
  metadata: {},
  usageCount: 0,
  textStatus: "missing",
  createdAt: "2026-09-18T00:00:00.000Z",
  attachmentId: "att_1",
};

const detail = { asset: ASSET, usages: [] };

const query = (data: unknown) => ({
  queryOptions: () => ({ queryKey: ["stub"], queryFn: async () => data }),
  key: () => ["stub"],
});
const noopMutation = { mutationOptions: () => ({ mutationFn: async () => undefined }) };

const orpcStub = {
  assets: {
    get: query(detail),
    list: query({ assets: [] }),
    delete: noopMutation,
    updateMetadata: noopMutation,
    putText: noopMutation,
    createTextUploadUrl: noopMutation,
    readTextLines: query({ lines: [], startLine: 1, endLine: 1, totalLines: 0, truncated: false }),
  },
} as unknown as BusabaseQueryUtils;

const render = (
  visitorKind: "anonymous" | "member",
  permissionLevel: "read" | "changeRequest" | "write" | "manage",
) => {
  const client = new QueryClient();
  // Prime the detail read so the view renders its loaded state synchronously.
  client.setQueryData(["stub"], detail);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <CoreI18nProvider locale="en">
        <DashboardVisitorProvider visitorKind={visitorKind}>
          <SubmitPermissionProvider permissionLevel={permissionLevel}>
            <AssetDetailView
              assetId="ast_1"
              onBack={() => undefined}
              onOpenNode={() => undefined}
              orpc={orpcStub}
            />
          </SubmitPermissionProvider>
        </DashboardVisitorProvider>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
};

const DELETE_LABEL = "Delete asset";

describe("AssetDetailView delete gate", () => {
  it("offers Delete asset to a member with workspace write", () => {
    expect(render("member", "write")).toContain(DELETE_LABEL);
  });

  it("still offers it at the manage default a demo workspace renders with", () => {
    // Cloud demo mode pins both gate inputs — `visitorKind` falls back to
    // `"member"` and `dashboard-view.tsx` forces `submitPermissionLevel` to
    // `"manage"` when `isDemo`. So the gate must be inert there; the demo
    // acceptance run confirms it against the real app, and this pins it.
    expect(render("member", "manage")).toContain(DELETE_LABEL);
  });

  it("hides Delete asset from a viewer", () => {
    expect(render("member", "read")).not.toContain(DELETE_LABEL);
  });

  it("hides Delete asset from an anonymous visitor even at the manage default", () => {
    // The public share view mounts the dashboard without `submitPermissionLevel`,
    // so a logged-out visitor inherits `"manage"`. A level-only gate would still
    // render the button for them.
    expect(render("anonymous", "manage")).not.toContain(DELETE_LABEL);
  });
});
