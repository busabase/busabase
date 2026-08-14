import { describe, expect, it } from "vitest";
import { isLocalHost } from "./login";

describe("isLocalHost", () => {
  it("recognizes loopback hosts, including bracketed IPv6", () => {
    for (const baseUrl of [
      "http://localhost:15419",
      "http://127.0.0.1:15419",
      "http://[::1]:15419",
      "https://localhost:15419",
    ]) {
      expect(isLocalHost(baseUrl)).toBe(true);
    }
  });

  it("rejects non-loopback hosts", () => {
    expect(isLocalHost("https://busabase.com")).toBe(false);
    expect(isLocalHost("https://self-hosted.example.com")).toBe(false);
  });

  it("returns false instead of throwing on an invalid URL", () => {
    expect(isLocalHost("not a url")).toBe(false);
  });
});
