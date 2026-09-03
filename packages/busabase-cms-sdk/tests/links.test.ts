import { describe, expect, it } from "vitest";
import { getSafeCmsExternalUrl } from "../src/links";

describe("CMS external links", () => {
  it("allows browser-safe HTTP attachment URLs", () => {
    expect(getSafeCmsExternalUrl("https://cdn.example.com/guide.pdf")).toBe(
      "https://cdn.example.com/guide.pdf",
    );
    expect(getSafeCmsExternalUrl("http://localhost:3000/file.txt")).toBe(
      "http://localhost:3000/file.txt",
    );
  });

  it("rejects executable, local, and malformed URLs", () => {
    expect(getSafeCmsExternalUrl("javascript:alert(1)")).toBeNull();
    expect(getSafeCmsExternalUrl("data:text/html,hello")).toBeNull();
    expect(getSafeCmsExternalUrl("file:///etc/passwd")).toBeNull();
    expect(getSafeCmsExternalUrl("not-a-url")).toBeNull();
  });
});
