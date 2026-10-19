import { describe, expect, it } from "vitest";
import { buildBlogPostJsonLd } from "./blog-post-jsonld";
import { buildOrganizationJsonLd, organizationIdFor, xProfileUrl } from "./organization-jsonld";

const BASE = {
  baseUrl: "https://buda.im",
  name: "Buda",
  logoUrl: "https://buda.im/icon.svg",
};

describe("organizationIdFor", () => {
  it("is the site origin plus #organization", () => {
    expect(organizationIdFor("https://buda.im")).toBe("https://buda.im/#organization");
  });

  it("does not double the slash for an origin with a trailing slash", () => {
    // appConfig.url values are not uniformly normalized across the fleet.
    expect(organizationIdFor("https://buda.im/")).toBe("https://buda.im/#organization");
  });
});

describe("the @id contract between the node and its references", () => {
  it("gives the Organization node exactly the @id a BlogPosting's publisher points at", () => {
    // The whole reason the id is derived in one place: a reference that is off by one
    // character resolves to nothing, and nothing anywhere reports it.
    const organization = buildOrganizationJsonLd(BASE);
    const nodes = buildBlogPostJsonLd(
      {
        baseUrl: "https://buda.im",
        defaultLocale: "en",
        siteName: "Buda",
        organizationId: organizationIdFor(BASE.baseUrl),
      },
      { path: "/blog/x", lang: "en", title: "X" },
    );
    const posting = nodes.find((node) => node["@type"] === "BlogPosting") as
      | { publisher?: { "@id"?: string } }
      | undefined;

    expect(posting?.publisher?.["@id"]).toBe(organization["@id"]);
  });
});

describe("buildOrganizationJsonLd", () => {
  it("emits a stable @id, which previewfile's copy never did", () => {
    expect(buildOrganizationJsonLd(BASE)["@id"]).toBe("https://buda.im/#organization");
  });

  it("emits the logo as an ImageObject", () => {
    expect(buildOrganizationJsonLd(BASE).logo).toEqual({
      "@type": "ImageObject",
      url: "https://buda.im/icon.svg",
    });
  });

  it("normalizes a trailing slash out of url as well as @id", () => {
    const node = buildOrganizationJsonLd({ ...BASE, baseUrl: "https://buda.im/" });

    expect(node.url).toBe("https://buda.im");
    expect(node["@id"]).toBe("https://buda.im/#organization");
  });

  it("drops falsy sameAs entries so callers can pass xProfileUrl(handle) unconditionally", () => {
    const node = buildOrganizationJsonLd({
      ...BASE,
      sameAs: [xProfileUrl("@buda_agent"), undefined, null, "", "https://instagram.com/buda"],
    });

    expect(node.sameAs).toEqual(["https://x.com/buda_agent", "https://instagram.com/buda"]);
  });

  it("omits sameAs entirely rather than emitting an empty list", () => {
    // sandock shipped `sameAs: []` full of commented-out placeholders.
    expect("sameAs" in buildOrganizationJsonLd({ ...BASE, sameAs: [undefined, ""] })).toBe(false);
    expect("sameAs" in buildOrganizationJsonLd(BASE)).toBe(false);
  });

  it("omits optional fields that were not supplied", () => {
    const node = buildOrganizationJsonLd(BASE);

    expect("description" in node).toBe(false);
    expect("email" in node).toBe(false);
    expect("contactPoint" in node).toBe(false);
  });

  it("carries a contactPoint with its schema.org type", () => {
    const node = buildOrganizationJsonLd({
      ...BASE,
      email: "support@sandock.ai",
      contactPoint: {
        contactType: "Customer Support",
        email: "support@sandock.ai",
        availableLanguage: ["English", "Chinese", "Japanese"],
      },
    });

    expect(node.email).toBe("support@sandock.ai");
    expect(node.contactPoint).toEqual({
      "@type": "ContactPoint",
      contactType: "Customer Support",
      email: "support@sandock.ai",
      availableLanguage: ["English", "Chinese", "Japanese"],
    });
  });
});

describe("xProfileUrl", () => {
  it("builds an x.com URL from a handle with or without the @", () => {
    expect(xProfileUrl("@buda_agent")).toBe("https://x.com/buda_agent");
    expect(xProfileUrl("buda_agent")).toBe("https://x.com/buda_agent");
    expect(xProfileUrl("  @buda_agent  ")).toBe("https://x.com/buda_agent");
  });

  it("returns undefined for an empty handle instead of publishing the X homepage", () => {
    // The old copies did `https://twitter.com/${handle.replace("@", "")}` unconditionally,
    // which for an empty handle is the site root — asserted as the organization's profile.
    expect(xProfileUrl("")).toBeUndefined();
    expect(xProfileUrl("@")).toBeUndefined();
    expect(xProfileUrl("   ")).toBeUndefined();
    expect(xProfileUrl(undefined)).toBeUndefined();
    expect(xProfileUrl(null)).toBeUndefined();
  });
});
