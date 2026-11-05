import { describe, expect, it } from "vitest";
import { organizationIdFor } from "./organization-jsonld";
import {
  buildFaqPageJsonLd,
  buildJsonLdGraph,
  buildOfferJsonLd,
  buildPlanOffersJsonLd,
  buildSoftwareApplicationJsonLd,
  buildWebSiteJsonLd,
  softwareApplicationIdFor,
  websiteIdFor,
} from "./site-jsonld";

const PLANS = [
  { planKey: "free", name: "Free", price: 0, currency: "USD" },
  { planKey: "plus", name: "Plus", description: "For one", price: 500, currency: "USD" },
  { planKey: "pro", name: "Pro", price: 2900, currency: "EUR" },
  { planKey: "enterprise", name: "Enterprise", price: 0, currency: "USD" },
];

describe("buildWebSiteJsonLd", () => {
  it("names the publisher by the Organization's own @id", () => {
    const node = buildWebSiteJsonLd({ baseUrl: "https://a.test/", name: "A", inLanguage: "ja" });
    expect(node).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": "https://a.test/#website",
      url: "https://a.test",
      name: "A",
      publisher: { "@id": organizationIdFor("https://a.test") },
      inLanguage: "ja",
    });
    expect(node["@id"]).toBe(websiteIdFor("https://a.test"));
  });

  it("omits inLanguage rather than guessing it", () => {
    expect(buildWebSiteJsonLd({ baseUrl: "https://a.test", name: "A" })).not.toHaveProperty(
      "inLanguage",
    );
  });
});

describe("buildPlanOffersJsonLd", () => {
  it("leaves out free and enterprise, whose price says nothing", () => {
    const offers = buildPlanOffersJsonLd(PLANS, "https://a.test/pricing");
    expect(offers.map((offer) => offer.name)).toEqual(["Plus", "Pro"]);
  });

  it("states the price in major units as a string, in the plan's currency", () => {
    expect(buildOfferJsonLd(PLANS[2], "https://a.test/pricing")).toEqual({
      "@type": "Offer",
      name: "Pro",
      price: "29.00",
      priceCurrency: "EUR",
      availability: "https://schema.org/InStock",
      url: "https://a.test/pricing",
    });
  });

  it("is empty for a site without a priced plan, like one still saying coming soon", () => {
    expect(buildPlanOffersJsonLd([PLANS[0], PLANS[3]], "https://a.test/pricing")).toEqual([]);
  });
});

describe("buildSoftwareApplicationJsonLd", () => {
  const IDENTITY = {
    baseUrl: "https://a.test/",
    name: "A",
    applicationCategory: "DeveloperApplication",
  };

  it("claims no price unless the page passes one", () => {
    const node = buildSoftwareApplicationJsonLd(IDENTITY);
    expect(node).not.toHaveProperty("offers");
    expect(buildSoftwareApplicationJsonLd({ ...IDENTITY, offers: [] })).not.toHaveProperty(
      "offers",
    );
    expect(node["@id"]).toBe(softwareApplicationIdFor("https://a.test"));
    expect(node.publisher).toEqual({ "@id": "https://a.test/#organization" });
    expect(node.operatingSystem).toBe("Web");
  });

  it("carries the offers it is given", () => {
    const offers = buildPlanOffersJsonLd(PLANS, "https://a.test/pricing");
    expect(buildSoftwareApplicationJsonLd({ ...IDENTITY, offers }).offers).toEqual(offers);
  });
});

describe("buildFaqPageJsonLd", () => {
  it("refuses a single question", () => {
    expect(buildFaqPageJsonLd([{ question: "q", answer: "a" }])).toBeUndefined();
  });

  it("maps each visible item", () => {
    const node = buildFaqPageJsonLd([
      { question: "q1", answer: "a1" },
      { question: "q2", answer: "a2" },
    ]);
    expect(node?.mainEntity[1]).toEqual({
      "@type": "Question",
      name: "q2",
      acceptedAnswer: { "@type": "Answer", text: "a2" },
    });
  });
});

describe("buildJsonLdGraph", () => {
  it("keeps one @context on the graph, not one per node", () => {
    const graph = buildJsonLdGraph([buildWebSiteJsonLd({ baseUrl: "https://a.test", name: "A" })]);
    expect(graph["@context"]).toBe("https://schema.org");
    expect(graph["@graph"][0]).not.toHaveProperty("@context");
    expect(Object.keys(graph["@graph"][0])[0]).toBe("@type");
  });
});
