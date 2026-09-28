// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { Component, type ReactNode, Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18nReactBindings, createLocaleLoader } from "./react";
import { createTranslationRegistry } from "./registry";
import type { Translatable } from "./typed-translations";

interface BaseTranslation {
  common: { greet: "Hi {name}" };
}
type Locale = "en" | "ja";

const trees: Record<Locale, Translatable<BaseTranslation>> = {
  en: { common: { greet: "Hi {name}" } },
  ja: { common: { greet: "こんにちは {name}" } },
};

/** A loader whose promises the test settles by hand, so the suspended state is observable. */
function manualLoader() {
  const resolvers = new Map<Locale, (tree: Translatable<BaseTranslation>) => void>();
  const rejecters = new Map<Locale, (error: Error) => void>();
  const loadLocale = vi.fn(
    (locale: Locale) =>
      new Promise<Translatable<BaseTranslation>>((resolve, reject) => {
        resolvers.set(locale, resolve);
        rejecters.set(locale, reject);
      }),
  );
  return {
    loadLocale,
    resolve: (locale: Locale) => resolvers.get(locale)?.(trees[locale]),
    reject: (locale: Locale) => rejecters.get(locale)?.(new Error(`chunk ${locale} failed`)),
  };
}

/**
 * React 19 only retries a component that suspended inside an *awaited* `act`;
 * testing-library's plain `render` wraps it in a sync one, so the retry never lands.
 */
async function renderAsync(ui: ReactNode) {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(ui);
  });
  return result as ReturnType<typeof render>;
}

class Catch extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div data-testid="error">{this.state.error.message}</div>
    ) : (
      this.props.children
    );
  }
}

describe("createI18nReactBindings — on-demand locales", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("suspends until the locale arrives, then renders it — and only fetches it once", async () => {
    const registry = createTranslationRegistry<Locale, BaseTranslation>();
    const loader = manualLoader();
    const { Provider, useI18nContext } = createI18nReactBindings(registry, {
      loadLocale: loader.loadLocale,
    });

    function Greet({ id }: { id: string }) {
      const { LL } = useI18nContext();
      return <div data-testid={id}>{LL.common.greet({ name: "Kelly" })}</div>;
    }

    await renderAsync(
      <Suspense fallback={<div data-testid="fallback" />}>
        <Provider locale="ja">
          <Greet id="a" />
        </Provider>
        <Provider locale="ja">
          <Greet id="b" />
        </Provider>
      </Suspense>,
    );
    expect(screen.getByTestId("fallback")).toBeTruthy();

    await act(async () => loader.resolve("ja"));
    expect((await screen.findByTestId("a")).textContent).toBe("こんにちは Kelly");
    expect(screen.getByTestId("b").textContent).toBe("こんにちは Kelly");
    expect(loader.loadLocale).toHaveBeenCalledTimes(1);
    expect(registry.isLocaleLoaded("ja")).toBe(true);
  });

  it("renders a server-supplied tree on the first render, without the loader", () => {
    // What keeps hydration from waiting on a chunk: the Next.js layout already
    // awaited the tree and hands it to the Provider.
    const registry = createTranslationRegistry<Locale, BaseTranslation>();
    const loader = manualLoader();
    const { Provider, useI18nContext } = createI18nReactBindings(registry, {
      loadLocale: loader.loadLocale,
    });
    function Greet() {
      return <div data-testid="greet">{useI18nContext().LL.common.greet({ name: "Kelly" })}</div>;
    }

    render(
      <Provider locale="ja" translations={trees.ja}>
        <Greet />
      </Provider>,
    );
    expect(screen.getByTestId("greet").textContent).toBe("こんにちは Kelly");
    expect(loader.loadLocale).not.toHaveBeenCalled();
  });

  it("does not call the loader for a locale that is already loaded", () => {
    const registry = createTranslationRegistry<Locale, BaseTranslation>({ en: trees.en });
    const loader = manualLoader();
    const { Provider, useI18nContext } = createI18nReactBindings(registry, {
      loadLocale: loader.loadLocale,
    });
    function Greet() {
      return <div data-testid="greet">{useI18nContext().LL.common.greet({ name: "Kelly" })}</div>;
    }

    render(
      <Provider locale="en">
        <Greet />
      </Provider>,
    );
    expect(screen.getByTestId("greet").textContent).toBe("Hi Kelly");
    expect(loader.loadLocale).not.toHaveBeenCalled();
  });

  it("useTranslations works outside any Provider", async () => {
    const registry = createTranslationRegistry<Locale, BaseTranslation>();
    const loader = manualLoader();
    const { useTranslations } = createI18nReactBindings(registry, {
      loadLocale: loader.loadLocale,
    });
    function NotFound() {
      return <div data-testid="greet">{useTranslations("ja").common.greet({ name: "Kelly" })}</div>;
    }

    await renderAsync(
      <Suspense fallback={null}>
        <NotFound />
      </Suspense>,
    );
    await act(async () => loader.resolve("ja"));
    expect((await screen.findByTestId("greet")).textContent).toBe("こんにちは Kelly");
  });

  it("surfaces a failed load to the error boundary instead of refetching in a loop", async () => {
    const registry = createTranslationRegistry<Locale, BaseTranslation>();
    const loader = manualLoader();
    const { useTranslations } = createI18nReactBindings(registry, {
      loadLocale: loader.loadLocale,
    });
    function Greet() {
      return <div data-testid="greet">{useTranslations("ja").common.greet({ name: "Kelly" })}</div>;
    }
    const tree = () => (
      <Catch>
        <Suspense fallback={null}>
          <Greet />
        </Suspense>
      </Catch>
    );

    vi.spyOn(console, "error").mockImplementation(() => {});
    const first = await renderAsync(tree());
    await act(async () => loader.reject("ja"));
    expect((await screen.findByTestId("error")).textContent).toBe("chunk ja failed");
    first.unmount();

    // Like React.lazy, the failure is sticky: a remount rethrows it rather than
    // hammering the network again.
    await renderAsync(tree());
    expect(screen.getByTestId("error").textContent).toBe("chunk ja failed");
    expect(loader.loadLocale).toHaveBeenCalledTimes(1);
  });

  it("without a loader, an unloaded locale still throws (unchanged behaviour)", () => {
    const registry = createTranslationRegistry<Locale, BaseTranslation>();
    const { Provider } = createI18nReactBindings(registry);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <Provider locale="ja">
          <div />
        </Provider>,
      ),
    ).toThrow(/not loaded/);
  });
});

describe("createLocaleLoader — per-locale data that isn't a translation tree", () => {
  afterEach(cleanup);

  it("suspends, then returns the loaded value synchronously on every later read", async () => {
    let resolve: (v: { title: string }) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<{ title: string }>((r) => {
          resolve = r;
        }),
    );
    const catalog = createLocaleLoader<Locale, { title: string }>(load);
    function Title() {
      return <div data-testid="title">{catalog.read("ja").title}</div>;
    }

    await renderAsync(
      <Suspense fallback={<div data-testid="fallback" />}>
        <Title />
      </Suspense>,
    );
    expect(screen.getByTestId("fallback")).toBeTruthy();
    await act(async () => resolve({ title: "設定" }));
    expect((await screen.findByTestId("title")).textContent).toBe("設定");
    cleanup();
    render(<Title />); // a later mount reads it synchronously, no second fetch
    expect(screen.getByTestId("title").textContent).toBe("設定");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("prime() makes a locale readable without suspending or fetching", () => {
    const load = vi.fn(async () => ({ title: "never" }));
    const catalog = createLocaleLoader<Locale, { title: string }>(load);
    catalog.prime("ja", { title: "設定" });
    function Title() {
      return <div data-testid="title">{catalog.read("ja").title}</div>;
    }
    render(<Title />);
    expect(screen.getByTestId("title").textContent).toBe("設定");
    expect(load).not.toHaveBeenCalled();
  });
});
