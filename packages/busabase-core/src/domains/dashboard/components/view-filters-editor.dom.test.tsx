// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { BaseFieldVO, ViewConfigVO } from "busabase-contract/types";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { ViewFiltersEditor } from "./view-config-editor";

const fields: BaseFieldVO[] = [
  {
    id: "title-id",
    baseId: "base",
    slug: "title",
    name: "Title",
    type: "text",
    required: true,
    position: 0,
    options: {},
  },
];
function Harness() {
  const [config, setConfig] = useState<ViewConfigVO>({ filters: [], sorts: [] });
  return (
    <CoreI18nProvider locale="en">
      <ViewFiltersEditor config={config} fields={fields} onChange={setConfig} />
      <output data-testid="config">{JSON.stringify(config)}</output>
    </CoreI18nProvider>
  );
}
afterEach(cleanup);
describe("nested view filter editor", () => {
  it("builds AND/OR groups, caps nesting and counts leaves rather than groups", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Add condition group" }));
    let groups = screen.getAllByTestId("view-filter-group");
    expect(screen.getByText("2 filters")).toBeTruthy();
    fireEvent.click(within(groups[0]).getByRole("button", { name: "Add filter" }));
    expect(screen.getByText("3 filters")).toBeTruthy();
    fireEvent.click(within(groups[0]).getByRole("button", { name: "Add condition group" }));
    groups = screen.getAllByTestId("view-filter-group");
    expect(within(groups[1]).queryByRole("button", { name: "Add condition group" })).toBeNull();
    fireEvent.change(screen.getAllByLabelText("Condition combination")[0], {
      target: { value: "or" },
    });
    const config = JSON.parse(screen.getByTestId("config").textContent ?? "{}");
    expect(config.filterConjunction).toBe("or");
    expect(config.filters[1].conjunction).toBe("or");
    fireEvent.click(
      within(groups[0]).getAllByRole("button", { name: "Remove condition group" })[0],
    );
    expect(screen.queryByTestId("view-filter-group")).toBeNull();
    expect(screen.getByText("1 filters")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(screen.getByText("0 filters")).toBeTruthy();
  });
  it("shows missing fields explicitly and lets the user remove the broken rule", () => {
    let result: ViewConfigVO | undefined;
    render(
      <CoreI18nProvider locale="en">
        <ViewFiltersEditor
          fields={fields}
          config={{
            filters: [
              {
                conjunction: "and",
                conditions: [{ fieldId: "old-id", fieldSlug: "title", operator: "is_empty" }],
              },
            ],
            sorts: [],
          }}
          onChange={(config) => {
            result = config;
          }}
        />
      </CoreI18nProvider>,
    );
    expect(screen.getByText("Field no longer available: title")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove filter" }));
    expect(result?.filters).toEqual([]);
  });
});
