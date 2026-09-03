/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AirAppIcon } from "./app-launcher";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const containers: HTMLDivElement[] = [];

const renderIcon = (icon: Parameters<typeof AirAppIcon>[0]["node"]["icon"]) => {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);

  act(() => {
    createRoot(container).render(
      <AirAppIcon
        node={{
          id: "app-1",
          icon,
          name: "Customer Portal",
          slug: "customer-portal",
          type: "airapp",
        }}
      />,
    );
  });

  return container;
};

afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

describe("AirAppIcon", () => {
  it("falls back to the stable monogram when an attachment fails to load", () => {
    const container = renderIcon({
      attachmentId: "attachment-1",
      type: "attachment",
      url: "/missing-app-icon.png",
    });
    const image = container.querySelector("img");

    expect(image?.getAttribute("src")).toBe("/missing-app-icon.png");
    act(() => image?.dispatchEvent(new Event("error")));

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("CP");
  });

  it("renders an explicit emoji instead of a generated monogram", () => {
    const container = renderIcon({ type: "emoji", value: "🧭" });

    expect(container.textContent).toBe("🧭");
  });
});
