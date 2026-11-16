import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  createPublicLocaleBootstrapScript,
  type PublicLocaleBootstrapOptions,
} from "./public-locale-bootstrap";

// Busabase Cloud: workspace subdomains, and no page a workspace host localizes.
const cloud: PublicLocaleBootstrapOptions = {
  workspaceHosts: { baseDomain: "busabase.com", reservedLabels: ["www", "community"] },
  supportedLocales: ["en", "zh-CN"],
  skipPaths: ["/dashboard", "/sign-in"],
};

// Buda: workspace subdomains whose sign-in pages exist in every language, and a
// `"/x/"` entry that skips only what is under `/x`.
const buda: PublicLocaleBootstrapOptions = {
  workspaceHosts: {
    baseDomain: "buda.im",
    reservedLabels: ["www", "community"],
    localizedPathPattern: String.raw`^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:sign-in|sign-up)(?:\/|$)`,
  },
  supportedLocales: ["en", "zh-CN", "ja"],
  skipPaths: ["/agents", "/spaces", "/courses/"],
};

function runBootstrap(
  options: PublicLocaleBootstrapOptions,
  hostname: string,
  pathname: string,
  cookie = "webpage_lang=zh-CN",
) {
  const redirects: string[] = [];
  const document = { documentElement: { lang: "en" }, cookie };
  const location = {
    hostname,
    pathname,
    search: "?view=all",
    hash: "",
    replace: (url: string) => redirects.push(url),
  };
  runInNewContext(createPublicLocaleBootstrapScript(options), {
    document,
    location,
    navigator: { language: "zh-CN" },
  });
  return { document, redirects };
}

describe("public locale bootstrap on workspace hosts", () => {
  it("keeps workspace paths short even with a Chinese language cookie", () => {
    expect(runBootstrap(cloud, "fpl.busabase.com", "/home").redirects).toEqual([]);
    expect(runBootstrap(cloud, "fpl.busabase.com", "/doc/abc").redirects).toEqual([]);
    expect(runBootstrap(buda, "apex-group.buda.im", "/agent/agt_1/new").redirects).toEqual([]);
    expect(runBootstrap(buda, "APEX-GROUP.buda.im", "/").redirects).toEqual([]);
  });

  it("still localizes public pages on the root and reserved hosts", () => {
    expect(runBootstrap(cloud, "busabase.com", "/home").redirects).toEqual([
      "/zh-CN/home?view=all",
    ]);
    expect(runBootstrap(cloud, "community.busabase.com", "/ask").redirects).toEqual([
      "/zh-CN/ask?view=all",
    ]);
    expect(runBootstrap(cloud, "www.busabase.com", "/home").redirects).toEqual([
      "/zh-CN/home?view=all",
    ]);
    // Deeper names and look-alike domains are not workspace hosts either.
    expect(runBootstrap(buda, "a.b.buda.im", "/agent/x").redirects).toEqual([
      "/zh-CN/agent/x?view=all",
    ]);
    expect(runBootstrap(buda, "evil-buda.im", "/agent/x").redirects).toEqual([
      "/zh-CN/agent/x?view=all",
    ]);
  });

  it("leaves platform routes outside the public locale redirect", () => {
    expect(runBootstrap(cloud, "busabase.com", "/dashboard/acme/home").redirects).toEqual([]);
  });

  it("keeps the localized pages a workspace host serves, when the app has them", () => {
    expect(runBootstrap(buda, "apex-group.buda.im", "/sign-in").redirects).toEqual([
      "/zh-CN/sign-in?view=all",
    ]);
    expect(runBootstrap(buda, "apex-group.buda.im", "/zh-CN/sign-in").redirects).toEqual([]);
    // Cloud names none, so its workspace hosts are left alone entirely.
    expect(runBootstrap(cloud, "fpl.busabase.com", "/sign-up").redirects).toEqual([]);
  });
});

describe("public locale bootstrap paths", () => {
  it("skips what is under a trailing-slash entry but localizes the entry itself", () => {
    expect(runBootstrap(buda, "buda.im", "/courses/intro").redirects).toEqual([]);
    expect(runBootstrap(buda, "buda.im", "/courses").redirects).toEqual([
      "/zh-CN/courses?view=all",
    ]);
  });

  it("leaves an English visitor where they are, and changes nothing without subdomains", () => {
    expect(runBootstrap(buda, "buda.im", "/pricing", "webpage_lang=en").redirects).toEqual([]);
    const noSubdomains = { ...buda, workspaceHosts: undefined };
    expect(runBootstrap(noSubdomains, "apex-group.buda.im", "/agent/x").redirects).toEqual([
      "/zh-CN/agent/x?view=all",
    ]);
  });
});
