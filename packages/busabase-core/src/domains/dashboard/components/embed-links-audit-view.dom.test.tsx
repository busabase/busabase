// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { EmbedLinkVO } from "busabase-contract/contract/embed-link-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { EmbedLinksAuditView } from "./embed-links-audit-view";
import { SubmitPermissionProvider } from "./split-submit-button";

const activeLink: EmbedLinkVO = {
  id: "emb_active",
  type: "node",
  typeId: "nod_handbook",
  targetName: "Handbook",
  nodeType: "doc",
  createdAt: "2026-09-16T01:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  revokedAt: null,
  active: true,
  framePolicy: { mode: "origins", allowedOrigins: ["https://docs.example.com"] },
};

const expiredLink: EmbedLinkVO = {
  ...activeLink,
  id: "emb_expired",
  targetName: "Old report",
  expiresAt: "2020-01-01T00:00:00.000Z",
  active: false,
};

type Page = { items: EmbedLinkVO[]; nextCursor: string | null };

function stubOrpc(
  listPage: (input: { status: string; limit: number; cursor?: string }) => Promise<Page>,
  revoke = vi.fn(async (_input: { id: string }) => ({ revoked: true as const })),
) {
  const listPaged = {
    infiniteOptions: ({
      input,
      initialPageParam,
      getNextPageParam,
    }: {
      input: (pageParam: string | undefined) => {
        status: string;
        limit: number;
        cursor?: string;
      };
      initialPageParam: string | undefined;
      getNextPageParam: (page: Page) => string | undefined;
    }) => {
      const firstInput = input(undefined);
      return {
        queryKey: ["embedLinks", "listPaged", firstInput.status],
        queryFn: ({ pageParam }: { pageParam: string | undefined }) => listPage(input(pageParam)),
        initialPageParam,
        getNextPageParam,
      };
    },
    key: () => ["embedLinks", "listPaged"],
  };
  return {
    orpc: {
      embedLinks: {
        listPaged,
        list: { key: () => ["embedLinks", "list"] },
        revoke: { mutationOptions: () => ({ mutationFn: revoke }) },
      },
    } as unknown as BusabaseQueryUtils,
    revoke,
  };
}

function renderAudit(orpc: BusabaseQueryUtils, permissionLevel: ApiKeyPermissionLevel) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CoreI18nProvider locale="en">
        <SubmitPermissionProvider permissionLevel={permissionLevel}>
          <EmbedLinksAuditView orpc={orpc} />
        </SubmitPermissionProvider>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EmbedLinksAuditView", () => {
  it.each(["read", "write"] as const)(
    "fails closed without requesting the audit at %s",
    async (permissionLevel) => {
      const listPage = vi.fn(async () => ({ items: [activeLink], nextCursor: null }));
      const { orpc } = stubOrpc(listPage);
      renderAudit(orpc, permissionLevel);

      expect(screen.getByText("Manage access required")).toBeTruthy();
      expect(listPage).not.toHaveBeenCalled();
    },
  );

  it("lists active links and switches to an expired server-side filter", async () => {
    const listPage = vi.fn(async ({ status }: { status: string }) => ({
      items: status === "expired" ? [expiredLink] : [activeLink],
      nextCursor: null,
    }));
    const { orpc } = stubOrpc(listPage);
    renderAudit(orpc, "manage");

    expect(await screen.findByText("Handbook")).toBeTruthy();
    expect(screen.getByText("https://docs.example.com")).toBeTruthy();
    expect(listPage).toHaveBeenCalledWith(expect.objectContaining({ status: "active" }));

    fireEvent.click(screen.getByRole("button", { name: "Expired" }));
    expect(await screen.findByText("Old report")).toBeTruthy();
    expect(listPage).toHaveBeenCalledWith(expect.objectContaining({ status: "expired" }));
  });

  it("does not describe a failed audit as an empty workspace", async () => {
    const { orpc } = stubOrpc(async () => {
      throw new Error("offline");
    });
    renderAudit(orpc, "manage");

    expect(await screen.findByText("Couldn't load embed links")).toBeTruthy();
    expect(screen.queryByText("No active embed links")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("can continue past a bounded ACL window with no visible targets", async () => {
    const listPage = vi.fn(async ({ cursor }: { cursor?: string }) =>
      cursor ? { items: [activeLink], nextCursor: null } : { items: [], nextCursor: "next-window" },
    );
    const { orpc } = stubOrpc(listPage);
    renderAudit(orpc, "manage");

    expect(await screen.findByText("More links may be available")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Handbook")).toBeTruthy();
    expect(listPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "next-window" }));
  });

  it("revokes an active link and refetches it out of the active view", async () => {
    let revoked = false;
    const listPage = vi.fn(async () => ({
      items: revoked ? [] : [activeLink],
      nextCursor: null,
    }));
    const revoke = vi.fn(async (_input: { id: string }) => {
      revoked = true;
      return { revoked: true as const };
    });
    const { orpc } = stubOrpc(listPage, revoke);
    renderAudit(orpc, "manage");

    expect(await screen.findByText("Handbook")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(await screen.findByText("Revoke this embed link?")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" }).at(-1) as HTMLElement);

    await waitFor(() => expect(revoke.mock.calls[0]?.[0]).toEqual({ id: activeLink.id }));
    expect(await screen.findByText("No active embed links")).toBeTruthy();
  });
});
