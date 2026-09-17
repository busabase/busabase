import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { DashboardVisitorProvider } from "../visitor-context";
import {
  draftRowsToMetadata,
  emptyDraftRow,
  metadataToDraftRows,
  metadataWritePayload,
  parseMetadataJson,
  pruneBlankRows,
  removedMetadataKeys,
} from "./asset-metadata-editor";
import { AssetMetadataBlock } from "./assets";
import { SubmitPermissionProvider } from "./split-submit-button";

Object.assign(globalThis, { React });

// The shape an agent actually writes: a summary string, a numeric hint, a
// boolean flag, an array of tags, and a nested object.
const agentMetadata = {
  summary: "Draft terms, pending legal",
  pages: 12,
  signed: false,
  tags: ["draft", "contract"],
  source: { kind: "slack", ts: "1712345678.0001" },
};

const roundTrip = (metadata: Record<string, unknown>) => {
  const folded = draftRowsToMetadata(metadataToDraftRows(metadata));
  if ("error" in folded) throw new Error(`unexpected draft error: ${folded.error.kind}`);
  return folded.metadata;
};

describe("asset metadata draft round-trip", () => {
  it("returns every value with the JS type it arrived as", () => {
    const next = roundTrip(agentMetadata);

    expect(next).toEqual(agentMetadata);
    expect(typeof next.summary).toBe("string");
    expect(typeof next.pages).toBe("number");
    expect(typeof next.signed).toBe("boolean");
    expect(Array.isArray(next.tags)).toBe(true);
    // Structure is carried through untouched, not re-serialized through a
    // textarea — identity is the strongest statement of that.
    expect(next.tags).toBe(agentMetadata.tags);
    expect(next.source).toBe(agentMetadata.source);
  });

  it("classifies structural values as read-only nested rows", () => {
    const rows = metadataToDraftRows({ ...agentMetadata, missing: null });
    const kinds = Object.fromEntries(rows.map((row) => [row.key, row.kind]));

    expect(kinds).toEqual({
      summary: "string",
      pages: "number",
      signed: "boolean",
      tags: "nested",
      source: "nested",
      missing: "nested",
    });
  });

  it("keeps an edited number a number", () => {
    const rows = metadataToDraftRows(agentMetadata).map((row) =>
      row.key === "pages" ? { ...row, text: "24" } : row,
    );
    const folded = draftRowsToMetadata(rows);

    expect(folded).toEqual({ metadata: { ...agentMetadata, pages: 24 } });
  });

  it("keeps a toggled boolean a boolean", () => {
    const rows = metadataToDraftRows(agentMetadata).map((row) =>
      row.key === "signed" ? { ...row, bool: true } : row,
    );
    const folded = draftRowsToMetadata(rows);

    expect(folded).toEqual({ metadata: { ...agentMetadata, signed: true } });
  });

  it("refuses a non-numeric value for a numeric key instead of stringifying it", () => {
    const rows = metadataToDraftRows(agentMetadata).map((row) =>
      row.key === "pages" ? { ...row, text: "twelve" } : row,
    );

    expect(draftRowsToMetadata(rows)).toEqual({
      error: { kind: "invalidNumber", key: "pages" },
    });
  });

  it("rejects empty and duplicated keys", () => {
    const rows = metadataToDraftRows({ a: "1", b: "2" });

    expect(draftRowsToMetadata(rows.map((row) => ({ ...row, key: "  " })))).toEqual({
      error: { kind: "emptyKey" },
    });
    expect(draftRowsToMetadata(rows.map((row) => ({ ...row, key: "same" })))).toEqual({
      error: { kind: "duplicateKey", key: "same" },
    });
  });

  it("ignores an untouched blank row but still flags a value with no key", () => {
    const filled = metadataToDraftRows({ summary: "x" });

    expect(pruneBlankRows([...filled, emptyDraftRow(0)])).toEqual(filled);
    expect(pruneBlankRows([...filled, { ...emptyDraftRow(0), text: "orphan" }])).toHaveLength(2);
    expect(
      draftRowsToMetadata(pruneBlankRows([...filled, { ...emptyDraftRow(0), text: "orphan" }])),
    ).toEqual({ error: { kind: "emptyKey" } });
  });

  it("trims keys but never values", () => {
    const rows = metadataToDraftRows({ summary: "x" }).map((row) => ({
      ...row,
      key: "  summary  ",
      text: " leading and trailing matter ",
    }));

    expect(draftRowsToMetadata(rows)).toEqual({
      metadata: { summary: " leading and trailing matter " },
    });
  });
});

describe("asset metadata write payload", () => {
  it("sends nothing when the draft is unchanged", () => {
    expect(metadataWritePayload(agentMetadata, roundTrip(agentMetadata))).toBeNull();
  });

  it("merges only what changed, so a key an agent added meanwhile survives", () => {
    const next = { ...roundTrip(agentMetadata), summary: "Signed, superseded v2" };

    expect(metadataWritePayload(agentMetadata, next)).toEqual({
      mode: "merge",
      metadata: { summary: "Signed, superseded v2" },
    });
  });

  it("merges an addition without resending untouched keys", () => {
    const next = { ...roundTrip(agentMetadata), owner: "priya" };

    expect(metadataWritePayload(agentMetadata, next)).toEqual({
      mode: "merge",
      metadata: { owner: "priya" },
    });
  });

  it("treats a retyped scalar as a change even when it prints the same", () => {
    expect(metadataWritePayload({ pages: 12 }, { pages: "12" })).toEqual({
      mode: "merge",
      metadata: { pages: "12" },
    });
  });

  it("rewrites the whole object only when a key was removed", () => {
    const next = roundTrip(agentMetadata);
    delete next.signed;

    expect(removedMetadataKeys(agentMetadata, next)).toEqual(["signed"]);
    expect(metadataWritePayload(agentMetadata, next)).toEqual({ mode: "replace", metadata: next });
  });

  it("treats the first key on an empty asset as a merge", () => {
    expect(metadataWritePayload(null, { summary: "First note" })).toEqual({
      mode: "merge",
      metadata: { summary: "First note" },
    });
  });
});

describe("asset metadata JSON mode", () => {
  it("accepts an object and reports anything else", () => {
    expect(parseMetadataJson('{"a":1}')).toEqual({ metadata: { a: 1 } });
    expect(parseMetadataJson("   ")).toEqual({ metadata: {} });
    expect(parseMetadataJson("{oops")).toEqual({ error: "invalidJson" });
    expect(parseMetadataJson("[1,2]")).toEqual({ error: "notAnObject" });
    expect(parseMetadataJson("null")).toEqual({ error: "notAnObject" });
    expect(parseMetadataJson('"a string"')).toEqual({ error: "notAnObject" });
  });
});

const orpcStub = {
  assets: {
    updateMetadata: { mutationOptions: () => ({ mutationFn: async () => undefined }) },
  },
} as unknown as BusabaseQueryUtils;

const renderBlock = ({
  editable,
  visitorKind,
  permissionLevel,
}: {
  editable: boolean;
  visitorKind: "anonymous" | "member";
  permissionLevel: "read" | "changeRequest" | "write" | "manage";
}) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <CoreI18nProvider locale="en">
        <DashboardVisitorProvider visitorKind={visitorKind}>
          <SubmitPermissionProvider permissionLevel={permissionLevel}>
            <AssetMetadataBlock
              assetId="ast_1"
              editable={editable}
              framed
              metadata={agentMetadata}
              onPersisted={async () => undefined}
              orpc={orpcStub}
            />
          </SubmitPermissionProvider>
        </DashboardVisitorProvider>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );

describe("AssetMetadataBlock edit gate", () => {
  it("offers Edit to a member with workspace write", () => {
    expect(
      renderBlock({ editable: true, visitorKind: "member", permissionLevel: "write" }),
    ).toContain(">Edit<");
  });

  it("hides Edit from an anonymous share visitor even at the manage default", () => {
    // `public-node-view.tsx` mounts the dashboard without a permission level, so
    // an anonymous visitor inherits `"manage"`. A level-only gate would leak an
    // Edit button the server would then refuse.
    const markup = renderBlock({
      editable: true,
      visitorKind: "anonymous",
      permissionLevel: "manage",
    });

    expect(markup).not.toContain(">Edit<");
    expect(markup).not.toContain("Add field");
  });

  it("hides Edit below write, including changeRequest", () => {
    for (const permissionLevel of ["read", "changeRequest"] as const) {
      expect(renderBlock({ editable: true, visitorKind: "member", permissionLevel })).not.toContain(
        ">Edit<",
      );
    }
  });

  it("stays read-only where the caller did not opt in", () => {
    // The node-settings-dialog mount relies on this default: its KUI dialog
    // cannot host a nested one.
    expect(
      renderBlock({ editable: false, visitorKind: "member", permissionLevel: "manage" }),
    ).not.toContain(">Edit<");
  });
});
