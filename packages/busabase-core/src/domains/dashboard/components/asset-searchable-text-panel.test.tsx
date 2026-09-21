import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AssetTextStatus } from "busabase-contract/types";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { DashboardVisitorProvider } from "../visitor-context";
import { AssetSearchableTextPanel } from "./assets";
import { SubmitPermissionProvider } from "./split-submit-button";

Object.assign(globalThis, { React });

const noopMutation = { mutationOptions: () => ({ mutationFn: async () => undefined }) };
const orpcStub = {
  assets: { putText: noopMutation, createTextUploadUrl: noopMutation },
} as unknown as BusabaseQueryUtils;

const renderPanel = ({
  visitorKind,
  permissionLevel,
  status = "missing",
}: {
  visitorKind: "anonymous" | "member";
  permissionLevel: "read" | "changeRequest" | "write" | "manage";
  status?: AssetTextStatus;
}) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <CoreI18nProvider locale="en">
        <DashboardVisitorProvider visitorKind={visitorKind}>
          <SubmitPermissionProvider permissionLevel={permissionLevel}>
            <AssetSearchableTextPanel
              assetId="ast_1"
              onPersisted={async () => undefined}
              orpc={orpcStub}
              status={status}
            />
          </SubmitPermissionProvider>
        </DashboardVisitorProvider>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );

const SUPPLY = "Supply searchable text";
const REPLACE = "Replace searchable text";
const MARK_NONE = "Mark as no text";

describe("AssetSearchableTextPanel write gate", () => {
  it("offers the writer to a member with workspace write", () => {
    const markup = renderPanel({ visitorKind: "member", permissionLevel: "write" });

    expect(markup).toContain(SUPPLY);
    expect(markup).toContain(MARK_NONE);
  });

  it("hides every write control from an anonymous share visitor even at the manage default", () => {
    // A host that renders a public share mounts `BusabaseDashboard` without
    // `submitPermissionLevel`, so a logged-out share visitor inherits the
    // `"manage"` default. A level-only gate would therefore still render
    // the writer — the anonymous half is what actually closes this, exactly as
    // it does for the `AssetMetadataBlock` sitting in the same card stack.
    const markup = renderPanel({
      visitorKind: "anonymous",
      permissionLevel: "manage",
      status: "present",
    });

    expect(markup).not.toContain(REPLACE);
    expect(markup).not.toContain(SUPPLY);
    expect(markup).not.toContain(MARK_NONE);
    // The card itself stays: the text status is readable, only the affordance
    // the server would refuse is gone.
    expect(markup).toContain("Searchable text");
  });

  it("hides every write control from a member below workspace write", () => {
    for (const permissionLevel of ["read", "changeRequest"] as const) {
      const markup = renderPanel({ visitorKind: "member", permissionLevel });

      expect(markup).not.toContain(SUPPLY);
      expect(markup).not.toContain(MARK_NONE);
      expect(markup).toContain("Searchable text");
    }
  });
});
