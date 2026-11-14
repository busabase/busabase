import { describe, expect, it } from "vitest";
import { isApexLikeHostname, suggestCounterpartHostname } from "./domain-counterpart";

describe("isApexLikeHostname", () => {
  it("accepts two-label roots and roots under a known second-level suffix", () => {
    for (const hostname of ["company.com", "company.io", "company.co.uk", "company.com.hk"]) {
      expect(isApexLikeHostname(hostname)).toBe(true);
    }
  });

  it("rejects subdomains, bare registry suffixes and unknown three-label names", () => {
    for (const hostname of [
      "shop.company.com",
      "www.company.co.uk",
      "co.uk",
      "com.hk",
      "a.b.example",
      "company",
    ]) {
      expect(isApexLikeHostname(hostname)).toBe(false);
    }
  });
});

describe("suggestCounterpartHostname", () => {
  it("suggests www for a root and the root for www", () => {
    expect(suggestCounterpartHostname("company.com", ["company.com"])).toBe("www.company.com");
    expect(suggestCounterpartHostname("www.company.co.uk", [])).toBe("company.co.uk");
  });

  it("suggests nothing once the counterpart is bound, or for other subdomains", () => {
    expect(suggestCounterpartHostname("company.com", ["company.com", "www.company.com"])).toBe(
      null,
    );
    expect(suggestCounterpartHostname("www.company.com", ["company.com"])).toBe(null);
    expect(suggestCounterpartHostname("shop.company.com", [])).toBe(null);
    expect(suggestCounterpartHostname("www.shop.company.com", [])).toBe(null);
  });
});
