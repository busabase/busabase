import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { BusabaseDashboard } from "./index";

Object.assign(globalThis, { React });

const useChromelessLocation = (): [string, (path: string) => void] => [
  "/airapp/example",
  () => undefined,
];
const useChromelessSearch = () => "?chromeless=1";

describe("BusabaseDashboard chromeless mode", () => {
  it("renders without requiring the sidebar context", () => {
    const markup = renderToStaticMarkup(
      <Router hook={useChromelessLocation} searchHook={useChromelessSearch}>
        <BusabaseDashboard
          bases={[]}
          changeRequests={[]}
          chromeless
          nodes={[]}
          records={[]}
          views={[]}
        />
      </Router>,
    );

    expect(markup).toContain("data-dashboard-active-view");
  });
});
