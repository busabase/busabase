// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AirAppSiteDomainBindingVO,
  AirAppSiteDomainsVO,
  AirAppSiteStateVO,
} from "busabase-contract/domains/airapp/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, type CoreLocale } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { AirAppSiteSettings } from "./AirAppSiteControls";

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
}: {
  domains?: AirAppSiteDomainsVO;
  state?: AirAppSiteStateVO;
  locale?: CoreLocale;
} = {}) => {
  const read = vi.fn().mockResolvedValue(domains);
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
        <AirAppSiteSettings nodeId="node" orpc={orpc} />
      </QueryClientProvider>
    </CoreI18nProvider>,
  );
  return { read, bind, unbind };
};

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

describe("website custom domain settings", () => {
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
    ).toContain("DNS only (grey cloud)");
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

  it("uses the active locale for the complete hostname form and removal flow", async () => {
    renderSettings({ domains: domainsState([binding()]), locale: "zh-CN" });
    expect(await screen.findByRole("textbox", { name: "域名" })).toBeTruthy();
    expect(screen.getByText("等待完成配置")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "移除 shop.company.com" }));
    expect(screen.getByRole("button", { name: "移除域名" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
  });
});

describe("custom domain translations", () => {
  it.each(Object.entries(coreMessagesByLocale))(
    "%s supplies every localized field and placeholder",
    (locale, messages) => {
      const english = coreMessagesByLocale.en.airapp.site.domains;
      const copy = messages.airapp.site.domains;
      expect(Object.keys(copy)).toEqual(Object.keys(english));
      for (const value of Object.values(copy)) {
        expect(value.length).toBeGreaterThan(0);
      }
      if (locale !== "en") expect(copy.title).not.toBe(english.title);
      expect(copy.copyValue).toContain("{value}");
      expect(copy.copyName).toContain("{value}");
      expect(copy.removeLabel).toContain("{hostname}");
      expect(copy.removeConfirm).toContain("{hostname}");
      expect(copy.dnsInstructions).toContain("Cloudflare");
      expect(copy.dnsInstructions).toContain("CNAME");
    },
  );
});
