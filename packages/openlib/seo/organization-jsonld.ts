/**
 * The site-wide schema.org `Organization` node, and the `@id` contract every other node
 * uses to point at it.
 *
 * ## Why the `@id` lives here
 *
 * A blog post's `BlogPosting`, a CMS page's `WebPage` and the like name their publisher by
 * reference — `publisher: { "@id": "https://buda.im/#organization" }` — instead of each
 * repeating the organization inline. That only works if the referenced node exists and its
 * `@id` is byte-for-byte the string the references use.
 *
 * Before this module, that string was written out by hand in 17 places across 8 apps: once
 * in each app's `<OrganizationSchema />` and again at every call site that passes
 * `organizationId`. They agreed by convention, not by construction — and previewfile shows
 * what convention is worth: its Organization component never set an `@id` at all, and was
 * never mounted either. `organizationIdFor` is now the one place the string is made; both
 * the node and every reference derive from it.
 *
 * ## Why one builder
 *
 * Eight hand-written copies had drifted into six variants: some escaped `<` and some did
 * not, some emitted `logo` as a string and one as an `ImageObject`, one shipped `sameAs: []`
 * full of commented-out placeholders, and the twitter URL was `twitter.com` in some and
 * `x.com` in others. The rules are the same for every app; only the identity differs, so
 * the app passes the identity and this owns the rules. Same split as
 * `CommunityJsonLdOptions` and `BlogPostJsonLdSite`.
 */

/** Canonical `@id` for an app's Organization node. */
export const organizationIdFor = (baseUrl: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/#organization`;

/**
 * An X (Twitter) profile URL from a handle, or `undefined` when there is no handle.
 *
 * Tolerates a leading `@` and surrounding whitespace. Returning `undefined` for an empty
 * handle matters: the previous copies built the URL unconditionally, so an empty handle
 * would have published `https://twitter.com/` — the X homepage — as the organization's
 * profile.
 */
export const xProfileUrl = (handle: string | null | undefined): string | undefined => {
  const profile = handle?.trim().replace(/^@/, "");
  return profile ? `https://x.com/${profile}` : undefined;
};

export interface OrganizationContactPoint {
  contactType: string;
  email?: string;
  availableLanguage?: readonly string[];
}

export interface OrganizationJsonLdInput {
  /** Absolute site origin, e.g. "https://buda.im". A trailing slash is tolerated. */
  baseUrl: string;
  name: string;
  /** Absolute logo URL. */
  logoUrl: string;
  description?: string;
  /**
   * This organization's profiles on OTHER platforms. schema.org defines `sameAs` as an
   * off-site identity, so the app's own pages — its forum, its docs — do not belong here.
   * Falsy entries are dropped, so callers can pass `xProfileUrl(handle)` unconditionally.
   */
  sameAs?: ReadonlyArray<string | null | undefined>;
  email?: string;
  contactPoint?: OrganizationContactPoint;
}

export const buildOrganizationJsonLd = (input: OrganizationJsonLdInput) => {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const sameAs = (input.sameAs ?? []).filter((value): value is string => Boolean(value));

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": organizationIdFor(baseUrl),
    name: input.name,
    url: baseUrl,
    logo: { "@type": "ImageObject", url: input.logoUrl },
    ...(input.description ? { description: input.description } : {}),
    ...(input.email ? { email: input.email } : {}),
    // An empty `sameAs` is omitted rather than emitted as `[]`: it asserts nothing, and
    // an empty list reads to a validator like a field someone forgot to fill.
    ...(sameAs.length ? { sameAs } : {}),
    ...(input.contactPoint
      ? {
          contactPoint: {
            "@type": "ContactPoint",
            contactType: input.contactPoint.contactType,
            ...(input.contactPoint.email ? { email: input.contactPoint.email } : {}),
            ...(input.contactPoint.availableLanguage?.length
              ? { availableLanguage: [...input.contactPoint.availableLanguage] }
              : {}),
          },
        }
      : {}),
  };
};
