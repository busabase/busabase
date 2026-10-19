import { describe, expect, it } from "vitest";
import { resolveAcprouterEnrollmentOrigin } from "./acprouter-origin-config";

describe("resolveAcprouterEnrollmentOrigin", () => {
  it("returns the origin for a valid configured bare-origin URL", () => {
    expect(
      resolveAcprouterEnrollmentOrigin({
        ACPROUTER_ENROLLMENT_ORIGIN: "https://router.example.com",
      }),
    ).toBe("https://router.example.com");
  });

  it("rejects a configured URL that carries a path", () => {
    expect(() =>
      resolveAcprouterEnrollmentOrigin({
        ACPROUTER_ENROLLMENT_ORIGIN: "https://router.example.com/api",
      }),
    ).toThrow(/must contain only an origin/);
  });

  it("rejects a configured URL that carries a query string", () => {
    expect(() =>
      resolveAcprouterEnrollmentOrigin({
        ACPROUTER_ENROLLMENT_ORIGIN: "https://router.example.com/?foo=bar",
      }),
    ).toThrow(/must contain only an origin/);
  });

  it("rejects a configured URL that carries credentials", () => {
    expect(() =>
      resolveAcprouterEnrollmentOrigin({
        ACPROUTER_ENROLLMENT_ORIGIN: "https://user:pass@router.example.com",
      }),
    ).toThrow(/must contain only an origin/);
  });

  it("rejects a non-http(s) protocol", () => {
    expect(() =>
      resolveAcprouterEnrollmentOrigin({ ACPROUTER_ENROLLMENT_ORIGIN: "ftp://router.example.com" }),
    ).toThrow(/must use http:\/\/ or https:\/\//);
  });

  it("rejects a value that isn't a URL at all", () => {
    expect(() =>
      resolveAcprouterEnrollmentOrigin({ ACPROUTER_ENROLLMENT_ORIGIN: "not-a-url" }),
    ).toThrow(/must be an absolute HTTP\(S\) URL/);
  });

  it("throws outside development when unset", () => {
    expect(() => resolveAcprouterEnrollmentOrigin({ NODE_ENV: "production" })).toThrow(
      /must be set/,
    );
  });

  it("throws even in development when unset — there is no request to fall back to", () => {
    expect(() => resolveAcprouterEnrollmentOrigin({ NODE_ENV: "development" })).toThrow(
      /even in development/,
    );
  });

  it("strips a trailing slash via URL normalization but still rejects any deeper path", () => {
    expect(
      resolveAcprouterEnrollmentOrigin({
        ACPROUTER_ENROLLMENT_ORIGIN: "https://router.example.com/",
      }),
    ).toBe("https://router.example.com");
  });
});
