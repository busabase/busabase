// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { NodeSettingsDialog } from "./node-settings-dialog";

const messages = coreMessagesByLocale.en;

const baseNode = {
  id: "nod_posts",
  parentId: "nod_brand",
  type: "base" as const,
  slug: "posts",
  name: "Posts",
  description: "Editorial calendar",
  metadata: {},
  settings: {},
  explicitVisibility: "workspace" as const,
  icon: null,
  position: 0,
  createdAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  baseId: "bas_posts",
  children: [],
};

const folderDetail: NodeDetailVO = {
  type: "folder",
  node: {
    ...baseNode,
    id: "nod_brand",
    parentId: null,
    type: "folder",
    slug: "brand",
    name: "Brand",
    description: "",
    baseId: null,
    explicitVisibility: null,
  },
  children: [],
  storagePrefix: "busabase/nodes/nod_brand/folder/",
  body: "",
};

const activityItem = {
  kind: "audit" as const,
  timestamp: "2026-10-01T12:00:00.000Z",
  record: null,
  auditEvent: {
    id: "aud_1",
    action: "node.metadata_updated" as const,
    actorId: "casey",
    actor: { id: "casey", name: "Casey", email: null, image: null },
    sourceAttribution: null,
    baseId: null,
    recordId: null,
    changeRequestId: null,
    operationId: null,
    commitId: null,
    metadata: {},
    createdAt: "2026-10-01T12:00:00.000Z",
  },
};

const share = {
  nodeId: "nod_posts",
  scope: "public" as const,
  capability: "read" as const,
  hasPassword: true,
  expiresAt: null,
  updatedAt: "2026-10-01T00:00:00.000Z",
};

function renderInfo(detail: NodeDetailVO, extra: Record<string, unknown> = {}) {
  const orpc = {
    nodes: {
      get: {
        queryOptions: ({ input }: { input: { nodeId: string } }) => ({
          queryKey: ["nodes", "get", input.nodeId],
          queryFn: async () => (input.nodeId === "nod_brand" ? folderDetail : detail),
        }),
      },
      share: {
        get: {
          queryOptions: () => ({
            queryKey: ["nodes", "share", detail.node.id],
            queryFn: async () => share,
          }),
        },
      },
      updateSettings: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      createChangeRequest: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
    activity: {
      listForNode: {
        queryOptions: () => ({
          queryKey: ["activity", detail.node.id],
          queryFn: async () => [activityItem],
        }),
      },
    },
    records: {
      count: {
        queryOptions: () => ({
          queryKey: ["records", "count"],
          queryFn: async () => ({ total: 42 }),
        }),
      },
    },
    bases: {
      get: {
        queryOptions: ({ input }: { input: { baseId: string } }) => ({
          queryKey: ["bases", "get", input.baseId],
          queryFn: async () =>
            input.baseId === "bas_leads"
              ? {
                  id: "bas_leads",
                  name: "Leads",
                  slug: "leads",
                  fields: [],
                  reviewPolicy: { requiredApprovals: 1 },
                }
              : {
                  id: "bas_posts",
                  name: "Posts",
                  slug: "posts",
                  fields: [{ id: "f1" }, { id: "f2" }, { id: "f3" }],
                  reviewPolicy: { kind: "single", requiredApprovals: 1 },
                },
        }),
      },
      listViews: {
        queryOptions: () => ({
          queryKey: ["bases", "views"],
          queryFn: async () => [{ id: "view_grid" }, { id: "view_board" }],
        }),
      },
    },
    forms: {
      getByNode: {
        queryOptions: () => ({
          queryKey: ["forms", "getByNode"],
          queryFn: async () => ({
            targetBaseId: "bas_leads",
            bindings: [{ fieldSlug: "name" }, { fieldSlug: "email" }, { fieldSlug: "note" }],
            submissionCount: 7,
            status: "active",
            share: { isPublic: true, anonymousSubmit: true },
          }),
        }),
      },
    },
    ...extra,
  } as unknown as BusabaseQueryUtils;

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <CoreI18nProvider locale="en">
        <Router>
          <NodeSettingsDialog
            initialTab="info"
            nodeId={detail.node.id}
            nodeName={detail.node.name}
            nodeSlug={detail.node.slug}
            nodeType={detail.type}
            onOpenChange={() => undefined}
            open
            orpc={orpc}
          />
        </Router>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
  return view;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("node settings info tab", () => {
  it("shows a data table's row, field, and view counts next to who changed it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderInfo({ type: "base", node: baseNode });

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(dialog.textContent).toContain("42");
    });
    expect(dialog.textContent).toContain(messages.nodeDetail.rows);
    expect(dialog.textContent).toContain(messages.common.fields);
    expect(dialog.textContent).toContain(messages.nodeDetail.views);
    expect(dialog.textContent).toContain("1 approval required");
    expect(dialog.textContent).toContain(messages.common.created);
    expect(dialog.textContent).toContain(messages.common.updated);
    expect(dialog.textContent).toContain("Brand");
    expect(dialog.textContent).toContain("Casey");
    expect(dialog.textContent).toContain(messages.activity.auditActions.nodeMetadataUpdated);
    expect(dialog.textContent).toContain(messages.share.enabled);
    expect(dialog.textContent).toContain(messages.share.passwordLabel);
    expect(dialog.textContent).toContain(messages.nav.workspace);

    fireEvent.click(
      screen.getByRole("button", {
        name: `${messages.nodeDetail.copyId}: ${messages.nodeDetail.nodeId}`,
      }),
    );
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("nod_posts");
    });
  });

  it("shows a file's size and type, and a skill's file total", async () => {
    const file: NodeDetailVO = {
      type: "file",
      node: {
        ...baseNode,
        id: "nod_logo",
        type: "file",
        slug: "logo",
        name: "Logo",
        baseId: null,
        parentId: null,
      },
      asset: {
        id: "ast_logo",
        attachmentId: "att_logo",
        name: "Logo",
        contentKind: "binary",
        metadata: {},
        fileName: "logo.png",
        mimeType: "image/png",
        size: 2048,
        url: "https://cdn.example/logo.png",
        contentHash: "sha256:abc",
        usageCount: 1,
        textStatus: "missing",
        createdAt: "2026-09-15T00:00:00.000Z",
      },
    };
    const fileView = renderInfo(file);
    await waitFor(() => {
      expect(screen.getByRole("dialog").textContent).toContain("2.0 KB");
    });
    expect(screen.getByRole("dialog").textContent).toContain("image/png");
    expect(screen.getByRole("dialog").textContent).toContain(messages.nodeDetail.workspaceRoot);
    expect(screen.getByRole("dialog").textContent).toContain(messages.common.created);
    fileView.unmount();

    const skill = {
      type: "skill" as const,
      node: {
        ...baseNode,
        id: "nod_weekly",
        type: "skill" as const,
        slug: "weekly",
        name: "Weekly",
        baseId: null,
        parentId: null,
        settings: {},
      },
      entryFile: "SKILL.md",
      visibility: "private" as const,
      version: "1.2.0",
      files: [
        {
          path: "SKILL.md",
          name: "SKILL.md",
          size: 100,
          updatedAt: null,
          mimeType: "text/markdown",
          assetId: "ast_1",
          displayName: null,
        },
      ],
      skippedGitignorePaths: [],
    };
    renderInfo(skill);
    await waitFor(() => {
      expect(screen.getByRole("dialog").textContent).toContain("v1.2.0");
    });
    expect(screen.getByRole("dialog").textContent).toContain("100 B");
    expect(screen.getByRole("dialog").textContent).toContain(messages.form.private);
  });

  it("shows a form's submissions, fields, and the base it writes into", async () => {
    const form: NodeDetailVO = {
      type: "form",
      node: {
        ...baseNode,
        id: "nod_intake",
        type: "form",
        slug: "intake",
        name: "Intake",
        baseId: null,
        parentId: null,
        description: "",
      },
    };
    renderInfo(form);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(dialog.textContent).toContain("Leads");
    });
    expect(dialog.textContent).toContain(messages.form.submitted);
    expect(dialog.textContent).toContain("7");
    expect(dialog.textContent).toContain(messages.form.fieldBindings);
    expect(dialog.textContent).toContain(messages.form.publicAnonymous);
    expect(dialog.textContent).toContain(messages.embedLinks.statusActive);
  });
});
