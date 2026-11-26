// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BaseVO, NodeVO } from "busabase-contract/types";
import { afterEach, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { ArchivedBasesView } from "./archived-bases";

afterEach(cleanup);
it("orders all deleted items by deletion time and restores the selected item", () => {
  const restore = vi.fn().mockResolvedValue(undefined);
  const base = {
    id: "base",
    name: "Older base",
    slug: "base",
    archivedAt: "2026-01-01T00:00:00Z",
  } as BaseVO;
  const node = {
    id: "node",
    name: "Newer doc",
    slug: "doc",
    type: "doc",
    archivedAt: "2026-02-01T00:00:00Z",
  } as NodeVO;
  const legacy = { id: "legacy", name: "Unknown date", slug: "old", type: "doc" } as NodeVO;
  const { container } = render(
    <CoreI18nProvider locale="en">
      <ArchivedBasesView
        archivedBases={[base]}
        archivedNodes={[legacy, node]}
        onRestoreBase={vi.fn()}
        onRestoreNode={restore}
      />
    </CoreI18nProvider>,
  );
  expect([...container.querySelectorAll("time")].map((el) => el.dateTime)).toEqual([
    node.archivedAt,
    base.archivedAt,
  ]);
  expect(container.textContent?.indexOf("Newer doc")).toBeLessThan(
    container.textContent?.indexOf("Older base") ?? 0,
  );
  expect(container.textContent?.indexOf("Older base")).toBeLessThan(
    container.textContent?.indexOf("Unknown date") ?? 0,
  );
  const firstRestore = screen.getAllByRole("button", { name: "Restore" })[0];
  if (!firstRestore) throw new Error("Missing restore button");
  fireEvent.click(firstRestore);
  expect(restore).toHaveBeenCalledWith(node);
});
