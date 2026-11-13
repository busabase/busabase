// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  type AirAppSiteDomainBindingVO,
  type AirAppSiteDomainIssue,
  type AirAppSiteDomainsVO,
  type AirAppSiteStateVO,
  airAppSiteDomainIssueSchema,
} from "busabase-contract/domains/airapp/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, type CoreLocale } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { AirAppSiteGoLive, AirAppSiteSettings } from "./AirAppSiteControls";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const siteState = (overrides: Partial<AirAppSiteStateVO> = {}): AirAppSiteStateVO => ({
  engine: "available",
  address: "https://default.sites.test",
  publication: "live",
  isPublic: true,
  previewUrl: "/api/airapp-preview/node/",
  previewVersion: "v1",
  liveVersion: "v1",
  currentVersion: "v1",
  previewStale: false,
  previewDeployedAt: null,
  liveDeployedAt: null,
  blockers: [],
  ...overrides,
});

const binding = (
  overrides: Partial<AirAppSiteDomainBindingVO> = {},
): AirAppSiteDomainBindingVO => ({
  hostname: "shop.company.com",
  url: "https://shop.company.com",
  status: "pending",
  hostnameStatus: "pending",
  sslStatus: "pending_validation",
  dnsRecords: [{ type: "CNAME", name: "shop.company.com", value: "site-dns.sites.test" }],
  errors: [],
  issues: [],
  ...overrides,
});

const domainsState = (
  bindings: AirAppSiteDomainBindingVO[] = [],
  available = true,
): AirAppSiteDomainsVO => ({
  available,
  cnameTarget: "site-dns.sites.test",
  bindings,
});

const clients: QueryClient[] = [];

const renderSettings = ({
  domains = domainsState(),
  state = siteState(),
  locale = "en",
  withToolbar = false,
  domainError,
}: {
  domains?: AirAppSiteDomainsVO;
  state?: AirAppSiteStateVO;
  locale?: CoreLocale;
  withToolbar?: boolean;
  domainError?: Error;
} = {}) => {
  const read = vi.fn().mockResolvedValue(domains);
  if (domainError) read.mockRejectedValue(domainError);
  const bind = vi.fn().mockResolvedValue(domainsState([binding()]));
  const unbind = vi.fn().mockResolvedValue(domainsState());
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(queryClient);
  const orpc = {
    airapps: {
      siteState: {
        queryOptions: () => ({
          queryKey: ["airapps", "siteState", "node"],
          queryFn: () => Promise.resolve(state),
        }),
      },
      siteDomains: {
        queryOptions: () => ({
          queryKey: ["airapps", "siteDomains", "node"],
          queryFn: read,
        }),
      },
      siteBindDomain: { call: bind },
      siteUnbindDomain: { call: unbind },
      siteRepublish: { call: vi.fn().mockResolvedValue({}) },
      siteUnpublish: { call: vi.fn().mockResolvedValue({}) },
    },
  } as unknown as BusabaseQueryUtils;
  render(
    <CoreI18nProvider locale={locale}>
      <QueryClientProvider client={queryClient}>
        {withToolbar ? (
          <AirAppSiteGoLive filesRevision="v1" nodeId="node" orpc={orpc} runStatus="idle" />
        ) : null}
        <AirAppSiteSettings nodeId="node" orpc={orpc} />
      </QueryClientProvider>
    </CoreI18nProvider>,
  );
  return { read, bind, unbind, queryClient };
};

const toolbarAddress = () =>
  document.querySelector<HTMLAnchorElement>("[data-airapp-site-open]")?.getAttribute("href");

const submitHostname = (value: string) => {
  const input = screen.getByRole("textbox", { name: "Domain name" });
  fireEvent.change(input, { target: { value } });
  const form = input.closest("form");
  if (!form) throw new Error("Domain input must submit through a native form");
  fireEvent.submit(form);
  return input as HTMLInputElement;
};

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.restoreAllMocks();
});

describe("website custom domain setup guide", () => {
  const guide = () => document.querySelector<HTMLElement>("[data-airapp-site-domain-guide]");
  const toggle = (name = "How to set up DNS") => screen.findByRole("button", { name });
  const mockClipboard = () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    return writeText;
  };

  it("keeps the guide to one closed toggle line before any domain is added", async () => {
    renderSettings();
    const button = await toggle();
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const controlled = document.getElementById(button.getAttribute("aria-controls") ?? "");
    expect(controlled).toBe(guide());
    expect(guide()?.hidden).toBe(true);
    expect(screen.queryByRole("button", { name: "Copy DNS value site-dns.sites.test" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Read the setup guide" })).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.queryByText(coreMessagesByLocale.en.airapp.site.domains.empty)).toBeNull();
    expect(screen.getByRole("textbox", { name: "Domain name" })).toBeTruthy();
  });

  it("opens the exact CNAME record on click, copies it, and folds away again", async () => {
    const writeText = mockClipboard();
    renderSettings();
    const button = await toggle();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(guide()?.hidden).toBe(false);
    const steps = guide()?.querySelectorAll("ol > li");
    expect(steps?.length).toBe(3);
    expect(steps?.[0]?.textContent).toContain("click “Add domain”");
    expect(steps?.[2]?.textContent).toContain("click “Check again”");
    expect(guide()?.querySelector("[data-airapp-site-domain-guide-record]")?.textContent).toContain(
      "CNAME",
    );
    expect(guide()?.querySelector("[data-airapp-site-domain-guide-target]")?.textContent).toBe(
      "site-dns.sites.test",
    );
    expect(guide()?.textContent).toContain("CNAME flattening");

    fireEvent.click(screen.getByRole("button", { name: "Copy DNS value site-dns.sites.test" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("site-dns.sites.test"));

    const link = screen.getByRole("link", { name: "Read the setup guide" });
    expect(link.getAttribute("href")).toBe(
      "https://busabase.com/docs/airapp-websites#custom-domains",
    );
    expect(link.getAttribute("target")).toBe("_blank");

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(guide()?.hidden).toBe(true);
    expect(screen.queryByRole("button", { name: "Copy DNS value site-dns.sites.test" })).toBeNull();
  });

  it("is reachable and operable from the keyboard as a native button", async () => {
    renderSettings();
    const button = await toggle();
    button.focus();
    expect(document.activeElement).toBe(button);
    // jsdom does not synthesize a native button's Enter/Space activation; browsers
    // turn both into this click, which the real-browser check exercises by key.
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(button);
  });

  it("lets an unpublished site prepare DNS while adding stays gated", async () => {
    renderSettings({
      state: siteState({ liveVersion: null, publication: "not-live", isPublic: false }),
    });
    fireEvent.click(await toggle());
    expect(guide()?.textContent).toContain("site-dns.sites.test");
    expect(screen.getByRole("textbox", { name: "Domain name" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Go live first, then add your domain.")).toBeTruthy();
  });

  it("replaces the toggle with the domain's own records once one is added", async () => {
    renderSettings();
    fireEvent.click(await toggle());
    submitHostname("shop.company.com");
    await screen.findByText("Setup pending");
    expect(screen.queryByRole("button", { name: "How to set up DNS" })).toBeNull();
    expect(guide()).toBeNull();
    expect(screen.getAllByText("site-dns.sites.test").length).toBe(1);
    expect(document.querySelector("[data-airapp-site-domain-name-hint]")?.textContent).toBe(
      coreMessagesByLocale.en.airapp.site.domains.recordNameHint,
    );
    expect(screen.getByRole("link", { name: "Read the setup guide" })).toBeTruthy();
  });

  it("comes back closed after the last domain is removed", async () => {
    const { unbind } = renderSettings();
    fireEvent.click(await toggle());
    submitHostname("shop.company.com");
    await screen.findByText("Setup pending");
    fireEvent.click(screen.getByRole("button", { name: "Remove shop.company.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove domain" }));
    await waitFor(() => expect(unbind).toHaveBeenCalledOnce());
    const button = await toggle();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(guide()?.hidden).toBe(true);
  });

  it.each([
    ["a lapsed plan", { state: siteState({ engine: "locked" }) }],
    ["a missing CNAME target", { domains: { ...domainsState(), cnameTarget: null } }],
  ])("shows neither toggle nor guide on %s", async (_reason, options) => {
    renderSettings(options);
    await screen.findByText(coreMessagesByLocale.en.airapp.site.domains.empty);
    expect(screen.queryByRole("button", { name: "How to set up DNS" })).toBeNull();
    expect(guide()).toBeNull();
  });

  it("links the localized guide and names the localized buttons", async () => {
    renderSettings({ locale: "zh-CN" });
    const button = await toggle("怎么配置 DNS？");
    expect(guide()?.hidden).toBe(true);
    fireEvent.click(button);
    expect(guide()?.textContent).toContain("点「添加域名」");
    expect(guide()?.textContent).toContain("点「重新检查」");
    expect(screen.getByRole("link", { name: "查看配置说明" }).getAttribute("href")).toBe(
      "https://busabase.com/zh-CN/docs/airapp-websites#custom-domains",
    );
  });

  it("links the English guide for a language without its own page", async () => {
    renderSettings({ locale: "de" });
    fireEvent.click(await toggle("So richtest du DNS ein"));
    expect(
      screen.getByRole("link", { name: "Einrichtungsanleitung öffnen" }).getAttribute("href"),
    ).toBe("https://busabase.com/docs/airapp-websites#custom-domains");
  });
});

describe("website custom domain settings", () => {
  it("keeps connected setup records behind a native disclosure", async () => {
    renderSettings({
      domains: domainsState([
        binding({ status: "active", hostnameStatus: "active", sslStatus: "active" }),
      ]),
    });
    await screen.findByText("Connected");
    const details = document.querySelector<HTMLDetailsElement>("[data-airapp-site-domain-setup]");
    expect(details).toBeTruthy();
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe(
      coreMessagesByLocale.en.nodeDetail.details,
    );
    expect(details?.querySelector("[data-airapp-site-dns-record]")?.textContent).toContain(
      "site-dns.sites.test",
    );
    expect(
      screen.getByRole("button", { name: "Copy DNS value site-dns.sites.test" }).closest("details"),
    ).toBe(details);
    expect(screen.getByRole("link", { name: "https://default.sites.test" })).toBeTruthy();
  });

  it("validates without losing the draft, then submits the normalized hostname through the form", async () => {
    const { bind } = renderSettings();
    await screen.findByRole("textbox", { name: "Domain name" });
    const input = submitHostname("https://shop.company.com/path");
    expect(screen.getByRole("alert").textContent).toContain("without a scheme");
    expect(input.value).toBe("https://shop.company.com/path");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(bind).not.toHaveBeenCalled();

    submitHostname(" SHOP.Company.com ");
    await screen.findByText("Setup pending");
    expect(bind).toHaveBeenCalledExactlyOnceWith({
      nodeId: "node",
      hostname: "shop.company.com",
    });
    expect(input.value).toBe("");
    expect(screen.getByText("site-dns.sites.test")).toBeTruthy();
    expect(
      screen.getByText(coreMessagesByLocale.en.airapp.site.domains.dnsInstructions).textContent,
    ).toContain("Cloudflare proxying is supported");
    expect(screen.getByRole("link", { name: "https://default.sites.test" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "shop.company.com" })).toBeNull();
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("keeps the typed hostname and existing DNS instructions after a bind conflict", async () => {
    const { bind } = renderSettings({ domains: domainsState([binding()]) });
    bind.mockRejectedValueOnce(new Error("This domain belongs to another website."));
    await screen.findByText("Setup pending");
    const input = submitHostname("other.company.com");
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "This domain belongs to another website.",
    );
    expect(input.value).toBe("other.company.com");
    expect(screen.getByText("site-dns.sites.test")).toBeTruthy();

    fireEvent.change(input, { target: { value: "correct.company.com" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps all bindings and the default address on a failed check, then shows fresh verified state on retry", async () => {
    const pending = binding();
    const { read } = renderSettings({
      domains: domainsState([pending, binding({ hostname: "docs.company.com" })]),
    });
    await screen.findAllByText("Setup pending");
    expect(document.querySelectorAll("[data-airapp-site-domain]").length).toBe(2);
    read.mockRejectedValueOnce(new Error("Provider temporarily unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Provider temporarily unavailable")).toBeTruthy();
    expect(document.querySelectorAll("[data-airapp-site-domain]").length).toBe(2);
    expect(screen.getByRole("link", { name: "https://default.sites.test" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Public" })).toBeTruthy();

    read.mockResolvedValueOnce(
      domainsState([binding({ status: "active", hostnameStatus: "active", sslStatus: "active" })]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("link", { name: "shop.company.com" })).toHaveProperty(
      "href",
      "https://shop.company.com/",
    );
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.queryByText("Provider temporarily unavailable")).toBeNull();
  });

  it("distinguishes HTTPS preparation from connected and copies exact long validation values", async () => {
    const longValue = `${"verification-token".repeat(15)}.certificate.example`;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderSettings({
      domains: domainsState([
        binding({
          hostnameStatus: "active",
          sslStatus: "pending_validation",
          dnsRecords: [{ type: "TXT", name: "_acme-challenge.shop.company.com", value: longValue }],
        }),
      ]),
    });
    await screen.findByText(coreMessagesByLocale.en.airapp.site.domains.pendingHttpsHint);
    expect(screen.queryByText("Connected")).toBeNull();
    const value = screen.getByText(longValue);
    expect(value.className).toContain("break-all");
    fireEvent.click(screen.getByRole("button", { name: `Copy DNS value ${longValue}` }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(longValue));
    await waitFor(() => expect(screen.getAllByText("Copied").length).toBeGreaterThan(0));
  });

  it("offers manual copying when the clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    renderSettings({ domains: domainsState([binding()]) });
    const copy = await screen.findByRole("button", {
      name: "Copy DNS value site-dns.sites.test",
    });
    fireEvent.click(copy);
    expect(
      await screen.findByText("Couldn't copy. Select the value and copy it manually."),
    ).toBeTruthy();
    expect(screen.getByText("site-dns.sites.test").className).toContain("select-all");
  });

  it("describes HTTP challenges as a served URL and response, separately from DNS records", async () => {
    const verificationUrl = "http://shop.company.com/.well-known/verification/token";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderSettings({
      domains: domainsState([
        binding({
          dnsRecords: [{ type: "HTTP", name: verificationUrl, value: "verification-body" }],
        }),
      ]),
    });
    expect(await screen.findByText("Verification URL")).toBeTruthy();
    expect(screen.getByText("Response body")).toBeTruthy();
    expect(
      screen.getByText(
        "For HTTP verification, serve the response body below at this URL, then check again.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(coreMessagesByLocale.en.airapp.site.domains.dnsInstructions),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: `Copy verification URL ${verificationUrl}` }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(verificationUrl));
  });

  it.each([
    ["a lapsed plan", siteState({ engine: "locked" })],
    [
      "an unpublished site",
      siteState({ liveVersion: null, publication: "not-live", isPublic: false }),
    ],
  ])("blocks binding on %s but keeps confirmed removal available", async (_reason, state) => {
    const { unbind } = renderSettings({ state, domains: domainsState([binding()]) });
    const input = await screen.findByRole("textbox", { name: "Domain name" });
    expect(input).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Add domain" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Remove shop.company.com" }));
    expect(unbind).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Remove domain" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove shop.company.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove domain" }));
    await waitFor(() =>
      expect(unbind).toHaveBeenCalledExactlyOnceWith({
        nodeId: "node",
        hostname: "shop.company.com",
      }),
    );
    await waitFor(() =>
      expect(document.querySelectorAll("[data-airapp-site-domain]").length).toBe(0),
    );
    expect(screen.getByText("https://default.sites.test")).toBeTruthy();
  });

  it("blocks adding after CNAME configuration is lost while preserving checks and confirmed removal", async () => {
    const { bind, unbind } = renderSettings({
      domains: { ...domainsState([binding()]), cnameTarget: null },
    });
    unbind.mockResolvedValueOnce({ ...domainsState([], false), cnameTarget: null });
    const input = await screen.findByRole("textbox", { name: "Domain name" });
    expect(input).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Add domain" })).toHaveProperty("disabled", true);
    expect(
      screen.getByText(
        "Custom domains are not configured on this deployment. Ask an administrator.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toHaveProperty("disabled", false);
    const form = input.closest("form");
    if (!form) throw new Error("Domain input must submit through a native form");
    fireEvent.submit(form);
    expect(bind).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove shop.company.com" }));
    expect(unbind).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove domain" }));
    await waitFor(() =>
      expect(unbind).toHaveBeenCalledExactlyOnceWith({
        nodeId: "node",
        hostname: "shop.company.com",
      }),
    );
    await waitFor(() =>
      expect(document.querySelectorAll("[data-airapp-site-domain]").length).toBe(0),
    );
    expect(screen.getByRole("link", { name: "https://default.sites.test" })).toBeTruthy();
  });

  it("keeps removal confirmation and the binding visible after a provider failure", async () => {
    const { unbind } = renderSettings({ domains: domainsState([binding()]) });
    unbind.mockRejectedValueOnce(new Error("Could not remove domain. Try again."));
    await screen.findByText("Setup pending");
    fireEvent.click(screen.getByRole("button", { name: "Remove shop.company.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove domain" }));
    expect(await screen.findByText("Could not remove domain. Try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove domain" })).toHaveProperty("disabled", false);
    expect(document.querySelectorAll("[data-airapp-site-domain]").length).toBe(1);
  });

  it("explains unavailable configuration without hiding the existing website controls", async () => {
    renderSettings({ domains: domainsState([], false) });
    expect(
      await screen.findByText(
        "Custom domains are not configured on this deployment. Ask an administrator.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Domain name" })).toBeNull();
    expect(screen.getByRole("link", { name: "https://default.sites.test" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Public" })).toBeTruthy();
  });

  it("words the server's own findings in the viewer's language and keeps provider text as written", async () => {
    renderSettings({
      domains: domainsState([
        binding({ issues: ["route-unverified"], errors: ["Certificate blocked by CAA"] }),
      ]),
      locale: "zh-CN",
    });
    expect(await screen.findByText("等待完成配置")).toBeTruthy();
    const issue = document.querySelector('[data-airapp-site-domain-issue="route-unverified"]');
    expect(issue?.textContent).toBe(
      coreMessagesByLocale["zh-CN"].airapp.site.domains.issues["route-unverified"],
    );
    expect(screen.getByText("Certificate blocked by CAA")).toBeTruthy();
    expect(document.body.textContent).not.toContain("route-unverified");
    expect(document.body.textContent).not.toContain("Could not verify");
  });

  it("shows a failed check as the finding itself, not the generic hint", async () => {
    renderSettings({
      domains: domainsState([binding({ status: "error", issues: ["check-failed"] })]),
      locale: "zh-CN",
    });
    const copy = coreMessagesByLocale["zh-CN"].airapp.site.domains;
    expect(await screen.findByText(copy.issues["check-failed"])).toBeTruthy();
    expect(screen.getByText(copy.issues["check-failed"]).closest("ul")?.className).toContain(
      "text-destructive",
    );
    expect(screen.queryByText(copy.errorHint)).toBeNull();
  });

  it("uses the active locale for the complete hostname form and removal flow", async () => {
    renderSettings({ domains: domainsState([binding()]), locale: "zh-CN" });
    expect(await screen.findByRole("textbox", { name: "域名" })).toBeTruthy();
    expect(screen.getByText("等待完成配置")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "移除 shop.company.com" }));
    expect(screen.getByRole("button", { name: "移除域名" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
  });
});

describe("website toolbar address", () => {
  it("opens the first active custom domain and skips pending and failed bindings", async () => {
    renderSettings({
      withToolbar: true,
      domains: domainsState([
        binding({ hostname: "a.company.com", url: "https://a.company.com" }),
        binding({
          hostname: "b.company.com",
          url: "https://b.company.com",
          status: "error",
          errors: ["Ownership verification failed"],
        }),
        binding({
          hostname: "c.company.com",
          url: "https://c.company.com",
          status: "active",
          hostnameStatus: "active",
          sslStatus: "active",
        }),
        binding({
          hostname: "d.company.com",
          url: "https://d.company.com",
          status: "active",
          hostnameStatus: "active",
          sslStatus: "active",
        }),
      ]),
    });
    await waitFor(() => expect(toolbarAddress()).toBe("https://c.company.com"));
    expect(document.querySelector("[data-airapp-site-open]")?.getAttribute("aria-label")).toBe(
      "https://c.company.com",
    );
    expect(screen.getByRole("link", { name: "https://default.sites.test" })).toBeTruthy();
  });

  it.each([
    ["no custom domains", domainsState()],
    ["pending DNS", domainsState([binding()])],
    [
      "pending HTTPS",
      domainsState([binding({ hostnameStatus: "active", sslStatus: "pending_validation" })]),
    ],
    ["provider errors", domainsState([binding({ status: "error" })])],
    ["unavailable custom domains", domainsState([], false)],
  ])("keeps the generated address for %s", async (_name, domains) => {
    renderSettings({ withToolbar: true, domains });
    await screen.findByRole("button", { name: "Check again" });
    await waitFor(() => expect(toolbarAddress()).toBe("https://default.sites.test"));
  });

  it("keeps the generated address when the domain query fails", async () => {
    renderSettings({
      withToolbar: true,
      domainError: new Error("Could not load custom domains"),
    });
    await screen.findByText("Could not load custom domains");
    expect(toolbarAddress()).toBe("https://default.sites.test");
    expect(screen.getByRole("switch", { name: "Public" })).toBeTruthy();
  });

  it("falls back after a failed check with stale active data and restores the domain on retry", async () => {
    const active = binding({
      status: "active",
      hostnameStatus: "active",
      sslStatus: "active",
    });
    const { read } = renderSettings({
      withToolbar: true,
      domains: domainsState([active]),
    });
    await waitFor(() => expect(toolbarAddress()).toBe("https://shop.company.com"));
    read.mockRejectedValueOnce(new Error("Provider temporarily unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await screen.findByText("Provider temporarily unavailable");
    expect(document.querySelectorAll("[data-airapp-site-domain]").length).toBe(1);
    expect(toolbarAddress()).toBe("https://default.sites.test");

    read.mockResolvedValueOnce(domainsState([active]));
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(toolbarAddress()).toBe("https://shop.company.com"));
  });

  it("updates immediately from bind and removal results through the shared query cache", async () => {
    const { bind, unbind, read } = renderSettings({ withToolbar: true });
    await screen.findByRole("textbox", { name: "Domain name" });
    await waitFor(() => expect(toolbarAddress()).toBe("https://default.sites.test"));
    const readsBeforeMutations = read.mock.calls.length;
    bind.mockResolvedValueOnce(
      domainsState([binding({ status: "active", hostnameStatus: "active", sslStatus: "active" })]),
    );
    submitHostname("shop.company.com");
    await waitFor(() => expect(toolbarAddress()).toBe("https://shop.company.com"));

    fireEvent.click(screen.getByRole("button", { name: "Remove shop.company.com" }));
    expect(unbind).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove domain" }));
    await waitFor(() => expect(toolbarAddress()).toBe("https://default.sites.test"));
    expect(read).toHaveBeenCalledTimes(readsBeforeMutations);
  });

  it("uses the newly active domain after checking DNS setup", async () => {
    const { read } = renderSettings({
      withToolbar: true,
      domains: domainsState([binding()]),
    });
    await screen.findByText("Setup pending");
    expect(toolbarAddress()).toBe("https://default.sites.test");
    read.mockResolvedValueOnce(
      domainsState([binding({ status: "active", hostnameStatus: "active", sslStatus: "active" })]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(toolbarAddress()).toBe("https://shop.company.com"));
  });

  it("does not fetch domains or show website controls for other engines", async () => {
    const { read, queryClient } = renderSettings({
      withToolbar: true,
      state: siteState({ engine: "not-offered", address: null }),
    });
    await waitFor(() =>
      expect(queryClient.getQueryState(["airapps", "siteState", "node"])?.status).toBe("success"),
    );
    expect(read).not.toHaveBeenCalled();
    expect(toolbarAddress()).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Go live" })).toBeNull();
  });
});

describe("custom domain translations", () => {
  it.each(Object.entries(coreMessagesByLocale))(
    "%s supplies every localized field and placeholder",
    (locale, messages) => {
      const english = coreMessagesByLocale.en.airapp.site.domains;
      const copy = messages.airapp.site.domains;
      expect(Object.keys(copy)).toEqual(Object.keys(english));
      const { issues, ...strings } = copy;
      for (const value of Object.values(strings)) {
        expect(value.length).toBeGreaterThan(0);
      }
      // Every finding the server can report has words in this language.
      expect(Object.keys(issues).sort()).toEqual([...airAppSiteDomainIssueSchema.options].sort());
      for (const [issue, value] of Object.entries(issues)) {
        expect(value.length).toBeGreaterThan(0);
        if (locale !== "en") {
          expect(value, issue).not.toBe(english.issues[issue as AirAppSiteDomainIssue]);
        }
      }
      if (locale !== "en") expect(copy.title).not.toBe(english.title);
      expect(copy.copyValue).toContain("{value}");
      expect(copy.copyName).toContain("{value}");
      expect(copy.removeLabel).toContain("{hostname}");
      expect(copy.removeConfirm).toContain("{hostname}");
      expect(copy.dnsInstructions).toContain("Cloudflare");
      expect(copy.dnsInstructions).toContain("DNS");
      expect(copy.guideStepAdd).toContain("{add}");
      expect(copy.guideStepCheck).toContain("{check}");
      expect(copy.guideStepDns).toContain("CNAME");
      expect(copy.guideRootDomain).toContain("company.com");
      expect(copy.guideNameHint).toContain("shop.company.com");
      expect(copy.recordNameHint).toContain("shop.company.com");
    },
  );
});
