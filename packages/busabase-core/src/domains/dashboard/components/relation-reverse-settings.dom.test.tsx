// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BaseVO, BaseFieldVO as FieldVO } from "busabase-contract/types";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { RelationReverseSettings, type ReverseColumnDraft } from "./relation-reverse-settings";

/**
 * The switch is the only way a user can get a two-way relation from the UI, and
 * which of its four states shows is decided by field shape alone — so each one
 * is rendered for real and read back as the user would read it.
 */
const field = (overrides: Partial<FieldVO> & { id: string; slug: string }): FieldVO =>
  ({
    name: overrides.slug,
    type: "relation",
    required: false,
    position: 0,
    options: {},
    ...overrides,
  }) as FieldVO;

const base = (id: string, name: string, fields: FieldVO[]) =>
  ({ id, name, slug: id, fields }) as unknown as BaseVO;

const forward = field({
  id: "fld_company",
  slug: "company",
  name: "Company",
  options: { targetBaseId: "bse_companies", multiple: false },
});
const deals = base("bse_deals", "Deals", [forward]);
const companiesPlain = base("bse_companies", "Companies", []);

const reverse = field({
  id: "fld_deals",
  slug: "deals",
  name: "Deals",
  options: { targetBaseId: "bse_deals", reverseOfFieldId: "fld_company", multiple: true },
});
const companiesWithReverse = base("bse_companies", "Companies", [reverse]);

afterEach(cleanup);

const Harness = (props: {
  base: BaseVO;
  bases: BaseVO[];
  field?: FieldVO | null;
  targetBaseId: string;
  initial?: ReverseColumnDraft;
  onDraft?: (draft: ReverseColumnDraft) => void;
}) => {
  const [value, setValue] = useState(props.initial ?? { enabled: true, name: "Deals" });
  return (
    <CoreI18nProvider locale="en">
      <RelationReverseSettings
        base={props.base}
        bases={props.bases}
        field={props.field}
        onChange={(next) => {
          setValue(next);
          props.onDraft?.(next);
        }}
        targetBaseId={props.targetBaseId}
        value={value}
      />
    </CoreI18nProvider>
  );
};

describe("RelationReverseSettings", () => {
  it("offers the switch, on by default, when adding a relation to another Base", () => {
    render(<Harness base={deals} bases={[deals, companiesPlain]} targetBaseId="bse_companies" />);
    const toggle = screen.getByRole("checkbox", {
      name: /Create a corresponding two-way relation field in Companies/,
    });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect((screen.getByDisplayValue("Deals") as HTMLInputElement).value).toBe("Deals");
  });

  it("hides the column name when the switch is off, and reports each change", () => {
    const drafts: ReverseColumnDraft[] = [];
    render(
      <Harness
        base={deals}
        bases={[deals, companiesPlain]}
        onDraft={(draft) => drafts.push(draft)}
        targetBaseId="bse_companies"
      />,
    );
    fireEvent.change(screen.getByDisplayValue("Deals"), { target: { value: "Pipeline" } });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(drafts).toEqual([
      { enabled: true, name: "Pipeline" },
      { enabled: false, name: "Pipeline" },
    ]);
    expect(screen.queryByDisplayValue("Pipeline")).toBeNull();
    expect(screen.queryByText(/Both sides can be edited/)).toBeNull();
    expect(screen.getByText(/Manage this link in Deals only/).textContent).toContain(
      "No corresponding field will be created in Companies",
    );
    expect(screen.getByText(/record details may still show source references/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText(/Both sides can be edited/)).toBeTruthy();
    expect(screen.queryByText(/Manage this link in Deals only/)).toBeNull();
  });

  it("shows no switch for a relation inside the same Base", () => {
    const { container } = render(
      <Harness base={deals} bases={[deals, companiesPlain]} targetBaseId="bse_deals" />,
    );
    expect(container.textContent).toBe("");
  });

  it("shows nothing until a target Base is picked, or when it is not visible", () => {
    const { container, rerender } = render(
      <Harness base={deals} bases={[deals, companiesPlain]} targetBaseId="" />,
    );
    expect(container.textContent).toBe("");
    rerender(<Harness base={deals} bases={[deals]} targetBaseId="bse_companies" />);
    expect(container.textContent).toBe("");
  });

  it("replaces the switch with a note once the other side already exists", () => {
    render(
      <Harness
        base={deals}
        bases={[deals, companiesWithReverse]}
        field={forward}
        targetBaseId="bse_companies"
      />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/Shown in Companies as “Deals”/)).toBeTruthy();
  });

  it("still offers the switch when editing an old one-sided relation", () => {
    render(
      <Harness
        base={deals}
        bases={[deals, companiesPlain]}
        field={forward}
        initial={{ enabled: false, name: "Deals" }}
        targetBaseId="bse_companies"
      />,
    );
    const toggle = screen.getByRole("checkbox") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
  });

  it("does not reuse another field's reverse column just because its target Base matches", () => {
    const other = field({
      id: "fld_reviewer_company",
      slug: "reviewer_company",
      options: { targetBaseId: "bse_companies" },
    });
    render(
      <Harness
        base={base(deals.id, deals.name, [forward, other])}
        bases={[deals, companiesWithReverse]}
        field={other}
        initial={{ enabled: false, name: "Reviewed deals" }}
        targetBaseId="bse_companies"
      />,
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText(/Shown in Companies as/)).toBeNull();
    expect(screen.getByText(/Manage this link in Deals only/)).toBeTruthy();
  });

  it("explains the reverse column itself instead of offering a switch", () => {
    render(
      <Harness
        base={companiesWithReverse}
        bases={[deals, companiesWithReverse]}
        field={reverse}
        targetBaseId="bse_deals"
      />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/The other side of Deals · Company/)).toBeTruthy();
  });

  it("disables the controls while saving", () => {
    render(
      <CoreI18nProvider locale="en">
        <RelationReverseSettings
          base={deals}
          bases={[deals, companiesPlain]}
          disabled
          onChange={() => {}}
          targetBaseId="bse_companies"
          value={{ enabled: true, name: "Deals" }}
        />
      </CoreI18nProvider>,
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByDisplayValue("Deals") as HTMLInputElement).disabled).toBe(true);
  });
});
