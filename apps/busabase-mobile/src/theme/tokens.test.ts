import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: {
    select: <T>(values: { default?: T }) => values.default,
  },
}));

const getTokens = () => import("./tokens");

describe("Busabase theme parity", () => {
  it("matches the Web cool-cement light palette", async () => {
    const { lightTokens } = await getTokens();
    expect(lightTokens).toMatchObject({
      background: "#F1F3F3",
      surface: "#F9FAFA",
      card: "#F9FAFA",
      sidebar: "#EDEFEF",
      foreground: "#161818",
      mutedForeground: "#6F7373",
      muted: "#E6E9E9",
      border: "#D6DADA",
      primary: "#161818",
      primaryForeground: "#F1F3F3",
      primaryMuted: "#E6E9E9",
    });
  });

  it("keeps Cha status colors synchronized across themes", async () => {
    const { darkTokens, lightTokens } = await getTokens();
    expect(lightTokens.merged).toEqual({ base: "#5E8C6A", text: "#406C4C" });
    expect(lightTokens.review).toEqual({ base: "#C79A3E", text: "#7F6221" });
    expect(lightTokens.rejected).toEqual({ base: "#B95B3F", text: "#9A4531" });
    expect(darkTokens.merged.text).toBe("#93C3A2");
    expect(darkTokens.review.text).toBe("#DCBD7C");
    expect(darkTokens.rejected.text).toBe("#DB9678");
  });

  it("matches Web AI, destructive, and dark surface semantics", async () => {
    const { darkTokens, lightTokens } = await getTokens();
    expect(lightTokens.ai).toEqual({ base: "#705496", text: "#684D8F", fill: "#7054962B" });
    expect(darkTokens.ai).toEqual({ base: "#705496", text: "#A792C4", fill: "#7054962B" });
    expect(lightTokens.destructive).toBe("#E7000B");
    expect(darkTokens).toMatchObject({
      sidebar: "#18181B",
      border: "rgba(255, 255, 255, 0.1)",
      primary: "#E5E5E5",
      destructive: "#FF6467",
    });
  });

  it("uses the architectural Web radius scale", async () => {
    const { radius } = await getTokens();
    expect(radius).toEqual({ sm: 0, md: 2, lg: 4, xl: 8, full: 999 });
  });
});
