/**
 * The schema.org nodes that describe a site as a whole: `WebSite`, `SoftwareApplication`, its
 * `Offer`s and a page's `FAQPage`. They sit next to `buildOrganizationJsonLd` and split the work the
 * same way: the app passes only its identity and what the page really shows, and this owns the rules.
 *
 * ## Only what the page shows
 *
 * Google treats markup describing content a visitor cannot see as a structured-data violation, so a
 * price or a question goes in only if the page it is rendered on shows it. That is a decision for the
 * page, not for this module: pass `offers` on a page with price cards, and omit them on a homepage
 * with none. A site-wide default would claim prices on pages that have none.
 *
 * ## Why the `@id`s are derived
 *
 * For the reason `organizationIdFor` is: a reference that is one character off resolves to nothing,
 * and nothing reports it. Search engines also do not reliably resolve an `@id` across pages, so a node
 * that names the publisher belongs on a page that also renders the `Organization`.
 */
import { organizationIdFor } from "./organization-jsonld";

const SCHEMA_CONTEXT = "https://schema.org";

const trimBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, "");

/** Canonical `@id` for an app's WebSite node. */
export const websiteIdFor = (baseUrl: string): string => `${trimBaseUrl(baseUrl)}/#website`;

/** Canonical `@id` for an app's SoftwareApplication node. */
export const softwareApplicationIdFor = (baseUrl: string): string =>
  `${trimBaseUrl(baseUrl)}/#software`;

export interface WebSiteJsonLdInput {
  /** Absolute site origin, e.g. "https://buda.im". A trailing slash is tolerated. */
  baseUrl: string;
  name: string;
  /** The language of the page's body, which on a locale fallback is not the requested locale. */
  inLanguage?: string;
}

export const buildWebSiteJsonLd = ({ baseUrl, name, inLanguage }: WebSiteJsonLdInput) => ({
  "@context": SCHEMA_CONTEXT,
  "@type": "WebSite",
  "@id": websiteIdFor(baseUrl),
  url: trimBaseUrl(baseUrl),
  name,
  publisher: { "@id": organizationIdFor(baseUrl) },
  ...(inLanguage ? { inLanguage } : {}),
});

/** The part of an app's `PricingPlan` an Offer needs. */
export interface OfferPlan {
  planKey: string;
  name: string;
  description?: string;
  /** In cents. */
  price: number;
  currency: string;
}

/** One plan as an Offer. `url` is the page showing its price. */
export const buildOfferJsonLd = (plan: OfferPlan, url: string) => ({
  "@type": "Offer",
  name: plan.name,
  ...(plan.description ? { description: plan.description } : {}),
  price: (plan.price / 100).toFixed(2),
  priceCurrency: plan.currency,
  availability: "https://schema.org/InStock",
  url,
});

/**
 * The plans that have a price, as Offers. Free carries no offer worth advertising, and Enterprise is
 * `price: 0` standing for "contact us", which as an Offer would read as free.
 */
export const buildPlanOffersJsonLd = (plans: readonly OfferPlan[], url: string) =>
  plans
    .filter((plan) => plan.price > 0 && plan.planKey !== "free" && plan.planKey !== "enterprise")
    .map((plan) => buildOfferJsonLd(plan, url));

export interface SoftwareApplicationJsonLdInput {
  /** Absolute site origin, e.g. "https://buda.im". A trailing slash is tolerated. */
  baseUrl: string;
  name: string;
  description?: string;
  /** One of the values Google's software-app documentation lists, e.g. "DeveloperApplication". */
  applicationCategory: string;
  operatingSystem?: string;
  /** Only on a page that shows these prices. An empty list is omitted. */
  offers?: ReadonlyArray<ReturnType<typeof buildOfferJsonLd>>;
}

export const buildSoftwareApplicationJsonLd = ({
  baseUrl,
  name,
  description,
  applicationCategory,
  operatingSystem = "Web",
  offers,
}: SoftwareApplicationJsonLdInput) => ({
  "@context": SCHEMA_CONTEXT,
  "@type": "SoftwareApplication",
  "@id": softwareApplicationIdFor(baseUrl),
  name,
  ...(description ? { description } : {}),
  url: trimBaseUrl(baseUrl),
  applicationCategory,
  operatingSystem,
  ...(offers?.length ? { offers: [...offers] } : {}),
  publisher: { "@id": organizationIdFor(baseUrl) },
});

export interface FaqEntry {
  question: string;
  answer: string;
}

/**
 * A `FAQPage` from the items the page renders. `undefined` below two entries, the same threshold as
 * busabase-cms-sdk's `buildCmsFaqJsonLd`: one question is not a FAQ, and the public SDK cannot import
 * this module, so `jsonld-parity.test.ts` holds the two copies together.
 */
export const buildFaqPageJsonLd = (entries: readonly FaqEntry[]) => {
  if (entries.length < 2) return undefined;
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "FAQPage",
    mainEntity: entries.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
};

/** Several nodes under one `@context`, for an app that renders a single script tag per page. */
export const buildJsonLdGraph = (nodes: ReadonlyArray<Record<string, unknown>>) => ({
  "@context": SCHEMA_CONTEXT,
  "@graph": nodes.map(({ "@context": _context, ...node }) => node),
});
