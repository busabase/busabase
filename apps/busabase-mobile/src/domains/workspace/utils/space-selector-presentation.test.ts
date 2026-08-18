import { describe, expect, it } from "vitest";
import type { BusabaseConnection, BusabaseSpace } from "~/connection/types";
import { en } from "~/i18n/messages";
import { getSpaceSelectorPresentation } from "./space-selector-presentation";

const cloudConnection: BusabaseConnection = {
  mode: "cloud",
  serverUrl: "https://cloud.busabase.com",
  connectedAt: "2026-08-18T00:00:00.000Z",
  cloudUser: { id: "user-1" },
};

const spaces: BusabaseSpace[] = [
  { id: "space-1", name: "Product", slug: "product", plan: "Pro" },
  { id: "space-2", name: "Research", slug: "research", plan: "Free" },
];

describe("getSpaceSelectorPresentation", () => {
  it("uses the selected Cloud workspace and reports the available workspace count", () => {
    const presentation = getSpaceSelectorPresentation({
      connection: { ...cloudConnection, selectedSpace: spaces[1] },
      spaces,
      isLoadingSpaces: false,
      t: en,
    });

    expect(presentation).toEqual({
      activeSpace: spaces[1],
      isCloud: true,
      planLabel: "Free",
      triggerSubtitle: "2 Workspaces",
      triggerTitle: "Research",
    });
  });

  it("shows Cloud loading and fallback labels before workspaces arrive", () => {
    expect(
      getSpaceSelectorPresentation({
        connection: cloudConnection,
        spaces: [],
        isLoadingSpaces: true,
        t: en,
      }),
    ).toMatchObject({
      activeSpace: null,
      isCloud: true,
      planLabel: "Cloud",
      triggerSubtitle: "Busabase Cloud",
      triggerTitle: "Loading workspace",
    });
  });

  it("keeps self-hosted and demo connections on their static workspace labels", () => {
    const selfHosted = getSpaceSelectorPresentation({
      connection: {
        mode: "self-hosted",
        serverUrl: "https://self-hosted.example.com",
        connectedAt: "2026-08-18T00:00:00.000Z",
      },
      spaces: [],
      isLoadingSpaces: false,
      t: en,
    });
    const demo = getSpaceSelectorPresentation({
      connection: {
        mode: "demo",
        serverUrl: "https://demo.example.com",
        connectedAt: "2026-08-18T00:00:00.000Z",
      },
      spaces: [],
      isLoadingSpaces: false,
      t: en,
    });

    expect(selfHosted).toMatchObject({
      isCloud: false,
      planLabel: "Local",
      triggerSubtitle: "https://self-hosted.example.com",
      triggerTitle: "Self-hosted workspace",
    });
    expect(demo).toMatchObject({
      isCloud: false,
      planLabel: "Demo",
      triggerSubtitle: "https://demo.example.com",
      triggerTitle: "Demo workspace",
    });
  });
});
