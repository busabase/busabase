import { describe, expect, it } from "vitest";
import {
  decodeEmbedCapability,
  EMBED_SECURITY_HEADERS,
  embedCapabilityCookieName,
  embedSecurityHeaders,
  encodeEmbedCapability,
  parseEmbedBootstrap,
  parseEmbedIframeCapability,
} from "./capability";

const idA = "emb_Abcdefghijklmno1";
const idB = "emb_Abcdefghijklmno2";
const secret = "A".repeat(43);

describe("embed capability bootstrap", () => {
  it("accepts only fixed-format public ids and 256-bit base64url secrets", () => {
    expect(parseEmbedBootstrap(`/embed/${idA}`, secret)).toEqual({ id: idA, secret });
    expect(parseEmbedIframeCapability(`/embed/${idA}/change-request`, secret, "iframe")).toEqual({
      id: idA,
      secret,
    });
    expect(parseEmbedIframeCapability(`/embed/${idA}/record-detail`, secret, "iframe")).toEqual({
      id: idA,
      secret,
    });
    expect(parseEmbedIframeCapability(`/embed/${idA}/detail`, secret, "iframe")).toBeNull();
    expect(parseEmbedIframeCapability(`/embed/change-request/${idA}`, secret, "iframe")).toBeNull();
    expect(parseEmbedBootstrap(`/embed/${idA}`, secret, "iframe")).toBeNull();
    expect(parseEmbedIframeCapability(`/embed/${idA}`, secret, "iframe")).toEqual({
      id: idA,
      secret,
    });
    expect(parseEmbedIframeCapability(`/embed/${idA}/airapp`, secret, "iframe")).toEqual({
      id: idA,
      secret,
    });
    expect(parseEmbedIframeCapability(`/airapp-embed/${idA}`, secret, "iframe")).toBeNull();
    expect(parseEmbedIframeCapability(`/embed/${idA}`, secret, null)).toBeNull();
    expect(parseEmbedBootstrap("/embed/%E0%A4%A", secret)).toBeNull();
    expect(parseEmbedBootstrap(`/embed/${idA}/extra`, secret)).toBeNull();
    expect(parseEmbedBootstrap(`/embed/${idA}`, "short")).toBeNull();
  });

  it("uses one HttpOnly cookie slot per public id", () => {
    expect(embedCapabilityCookieName(idA)).not.toBe(embedCapabilityCookieName(idB));
    expect(decodeEmbedCapability(encodeEmbedCapability(idA, secret))).toEqual({ id: idA, secret });
  });

  it("declares non-cacheable, top-level-only response headers", () => {
    expect(EMBED_SECURITY_HEADERS).toEqual({
      "cache-control": "private, no-store, max-age=0",
      "content-security-policy": "frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    });
  });

  it("builds frame headers from the verified link policy", () => {
    expect(embedSecurityHeaders({ mode: "anywhere", allowedOrigins: [] })).toEqual({
      "cache-control": "private, no-store, max-age=0",
      "content-security-policy": "frame-ancestors *",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    expect(
      embedSecurityHeaders({
        mode: "origins",
        allowedOrigins: ["https://agent.example", "http://localhost:4173"],
      }),
    ).toEqual({
      "cache-control": "private, no-store, max-age=0",
      "content-security-policy": "frame-ancestors https://agent.example http://localhost:4173",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    expect(embedSecurityHeaders({ mode: "top-level-only", allowedOrigins: [] })).toHaveProperty(
      "x-frame-options",
      "DENY",
    );
  });
});
