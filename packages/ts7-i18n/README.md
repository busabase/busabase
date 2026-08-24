<h1 align="center">ts7-i18n</h1>

<p align="center">
  <b>Type-safe i18n that runs on TypeScript 7.</b><br>
  No codegen. No CLI. No <code>postinstall</code>. No TypeScript-compiler-API dependency.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ts7-i18n"><img alt="npm" src="https://img.shields.io/npm/v/ts7-i18n.svg?color=cb3837&logo=npm"></a>
  <a href="https://www.npmjs.com/package/ts7-i18n"><img alt="minzipped size" src="https://img.shields.io/bundlephobia/minzip/ts7-i18n?color=success"></a>
  <img alt="zero dependencies" src="https://img.shields.io/badge/dependencies-0-success">
  <img alt="TypeScript 7" src="https://img.shields.io/badge/TypeScript-7.0-3178c6?logo=typescript&logoColor=white">
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/npm/l/ts7-i18n.svg?color=blue"></a>
</p>

---

Your translation strings *are* the types. Parameters are read straight off the
string literal — at compile time, with nothing to generate and nothing to keep
in sync.

```ts
const en = {
  greeting: "Hi {name}, you have {count} new message{{s}}",
} as const;

LL.greeting({ name: "Kelly", count: 3 }); // ✅ "Hi Kelly, you have 3 new messages"
LL.greeting({ name: "Kelly" });           // ❌ Property 'count' is missing
LL.greeting({ nme: "Kelly", count: 3 });  // ❌ 'nme' does not exist in type
```

That's the whole idea. No `i18n-types.ts`, no watcher, no build step.

## Why this exists

[typesafe-i18n](https://github.com/ivanhofer/typesafe-i18n) is a genuinely good
library, and this package is shaped to feel like it on purpose. But it — and the
tooling usually paired with it — **cannot run under TypeScript 7**, the native
Go compiler ("Corsa", GA 2026-07-08):

- **typesafe-i18n's CLI** (`typesafe-i18n --no-watch`, usually a `postinstall`
  step that generates `i18n-types.ts`) calls `ts.createProgram` directly to
  transpile your base locale. TS7 does not expose that API to plugins
  (upstream: codingcommons/typesafe-i18n#794).
- **tsup**, a common bundler pairing, embeds a TypeScript-5.7-era
  `rollup-plugin-dts` that crashes outright under TS7
  (`ts.createProgram is not a function`-class errors — upstream:
  egoist/tsup#1405, #1408).

Both failures share one root cause: depending on the TypeScript **compiler API**
at build time. `ts7-i18n` sidesteps the entire class of problem by never
touching it — template-literal types plus a small runtime tree-walker.

|                                   | typesafe-i18n           | **ts7-i18n**            |
| --------------------------------- | ----------------------- | ----------------------- |
| Runs on TypeScript 7              | ✖                       | ✔                       |
| Codegen / CLI / `postinstall`     | required                | **none**                |
| Generated file to keep in sync    | `i18n-types.ts`         | **none**                |
| Param types from string literals  | ✔ (via codegen)         | ✔ (via the type system) |
| Key-parity across locales         | ✔                       | ✔                       |
| Param-parity across locales       | ✖                       | ✔ (runtime assert)      |
| `{{…}}` plural shorthand          | ✔                       | ✔ (same semantics)      |
| Runtime dependencies              | 0                       | **0**                   |
| Formatters (`{x\|uppercase}`)     | ✔                       | ✖                       |
| Full ICU (`{c, plural, one {…}}`) | ✖                       | ✖                       |

It also dogfoods its own advice: `isolatedDeclarations: true` from day one, so
its `.d.ts` emission works identically under `tsc`, `tsgo`, or `oxc` — proof,
not a claim, that "TS7-native" is achievable.

## Install

```bash
npm i ts7-i18n     # or: pnpm add ts7-i18n / yarn add ts7-i18n / bun add ts7-i18n
```

React is an **optional** peer dependency — needed only for the `ts7-i18n/react`
entry point. The registry half has no React import at all.

## Quick start

```ts
// i18n/en/index.ts — your base locale, as-is, plus `as const`
export const en = {
  common: { save: "Save", greet: "Hi {name}" },
} as const;

export type BaseTranslation = typeof en;
```

> **Why `as const`?** It's what preserves the string *literal* types that the
> parameter inference reads. Without it every string widens to `string`, and
> `LL.common.greet` degrades to a zero-argument function. Only the base locale
> needs it.

```ts
// i18n/zh-CN/index.ts — every other locale, typed against the base
import type { Translatable } from "ts7-i18n";
import type { BaseTranslation } from "../en";

// Missing a key, adding an extra one, or nesting one at the wrong depth
// compared to `en` is a compile error.
export const zhCN: Translatable<BaseTranslation> = {
  common: { save: "保存", greet: "你好 {name}" },
};
```

```tsx
// i18n/index.ts
import { createTypedI18n } from "ts7-i18n";
import { en } from "./en";
import { zhCN } from "./zh-CN";

export const { Provider: I18nProvider, useI18nContext } = createTypedI18n({
  en,
  "zh-CN": zhCN,
});
```

```tsx
// anywhere under <I18nProvider>
const { LL } = useI18nContext();
LL.common.save(); // "Save" — no args allowed, and TS enforces that
LL.common.greet({ name: "Kelly" }); // "Hi Kelly" — `name` is required and typed
```

## Plurals

typesafe-i18n's `{{…}}` plural shorthand is supported as-is, so strings port
over unchanged. A block binds to the nearest *preceding* parameter (or an
explicit `{{key:…}}`), and the form is chosen by that locale's own
`Intl.PluralRules` categories:

```ts
"{count} listing{{s}}"          // 1 → "1 listing"      2 → "2 listings"
"{n} {{item|items}}"            // one | other
"{n} {{none|one thing|lots}}"   // zero | one | other
"{n} {{Z|O|T|F|M|R}}"           // zero | one | two | few | many | other
"{a} and {b} file{{a:|s}}"      // explicit key — binds to `a`, not `b`
"{n} {{no items|?? items}}"     // `??` is replaced with the bound value
```

Because a plural block binds to an existing parameter, it adds no new required
params — `"{count} listing{{s}}"` still takes just `{ count }`, and `{{s}}` is
never mistaken for a parameter named `s`.

Full ICU syntax (`{count, plural, one {…} other {…}}`) is **not** supported.

## Lazy-loaded locales (code splitting)

Locales don't have to all be known up front. Call `loadLocale` any time before
rendering `Provider` (or calling `getTranslations`) with that locale — useful
for splitting locale bundles behind a dynamic `import()`:

```ts
const i18n = createTypedI18n<"en" | "zh-CN", BaseTranslation>();

async function switchTo(locale: "en" | "zh-CN") {
  if (!i18n.isLocaleLoaded(locale)) {
    const mod = await import(`./i18n/${locale}`);
    i18n.loadLocale(locale, mod.default);
  }
}
```

## Server Components (Next.js App Router)

`getTranslations(locale)` returns the same `LL` accessor without going through
React context — for Server Components, server actions, or anywhere else that
isn't inside a `Provider`. But if you're on Next.js's App Router, don't get it
from `createTypedI18n`'s combined return value in code a Server Component
imports — import from the two split entry points instead:

- `ts7-i18n/registry` — `createTranslationRegistry`, zero `react` import.
  Safe from Server Components, middleware, anywhere.
- `ts7-i18n/react` — `createI18nReactBindings(registry)`, a `"use client"`
  module wrapping an existing registry with `Provider`/`useI18nContext`.

This split exists because Next's App Router statically flags **any file that
imports `react`'s `createContext`** as reachable only from Client Components —
even if nothing on that particular import path ever calls it. `createTypedI18n`
(and its `Provider`/`useI18nContext`) does import `createContext`, so a module
that only wants `getTranslations`/`loadLocale` but imports it anyway drags that
flag in and breaks the first Server Component that reaches it:

```ts
// i18n/registry.ts — import-safe from Server Components/middleware
import { createTranslationRegistry } from "ts7-i18n/registry";
import type { BaseTranslation } from "./en";

export const registry = createTranslationRegistry<"en" | "zh-CN", BaseTranslation>();
export const { loadLocale, isLocaleLoaded, getTranslations } = registry;
```

```tsx
// i18n/react.tsx — only ever imported by "use client" component files
import { createI18nReactBindings } from "ts7-i18n/react";
import { registry } from "./registry";

export const { Provider, useI18nContext } = createI18nReactBindings(registry);
```

If your app doesn't have a Server/Client Component boundary to worry about
(most non-Next.js apps, or a Next.js app that only ever touches i18n from
Client Components), the combined `createTypedI18n` from the root import is
simpler and behaves identically.

## Plurals

typesafe-i18n's `{{…}}` plural shorthand is supported as-is, so strings port
over unchanged. A block binds to the nearest *preceding* parameter (or an
explicit `{{key:…}}`), and the form is chosen by that locale's own
`Intl.PluralRules` categories:

```ts
"{count} listing{{s}}"          // 1 → "1 listing"      2 → "2 listings"
"{n} {{item|items}}"            // one | other
"{n} {{none|one thing|lots}}"   // zero | one | other
"{n} {{Z|O|T|F|M|R}}"           // zero | one | two | few | many | other
"{a} and {b} file{{a:|s}}"      // explicit key — binds to `a`, not `b`
"{n} {{no items|?? items}}"     // `??` is replaced with the bound value
```

Because a plural block binds to an existing parameter, it adds no new required
params — `"{count} listing{{s}}"` still takes just `{ count }`, and `{{s}}` is
never mistaken for a parameter named `s`.

Full ICU syntax (`{count, plural, one {…} other {…}}`) is **not** supported.

## The one capability gap versus typesafe-i18n

TypeScript's type system cannot compare two *independent* string literal types'
extracted `{param}` sets across separate files — so `Translatable<T>` enforces
key-structure parity (missing/extra/misnested keys) at compile time, but it
cannot catch a translated string that drops or adds a `{param}` compared to the
base locale's version of the same key. That's a runtime check, via
`assertLocaleParamParity`, meant to run once in your test suite:

```ts
import { assertLocaleParamParity } from "ts7-i18n";
import { en } from "./i18n/en";
import { zhCN } from "./i18n/zh-CN";

test("locale param parity", () => {
  assertLocaleParamParity(en, { "zh-CN": zhCN });
});
```

Worth noting this is a capability typesafe-i18n never had either — it enforced
key structure, never param parity.

## Recommended tsconfig

If you'd like your own package to pick up the same TS7-friendly settings
`ts7-i18n` itself uses:

```json
{
  "extends": "ts7-i18n/tsconfig-recommended.json"
}
```

## API

- `createTypedI18n<Locale, T>(initialTranslations?)` (root import) → `{ Provider, useI18nContext, loadLocale, isLocaleLoaded, getTranslations }`
- `ts7-i18n/registry`: `createTranslationRegistry<Locale, T>(initialTranslations?)` → `{ loadLocale, isLocaleLoaded, getTranslations }` — zero `react` import
- `ts7-i18n/react`: `createI18nReactBindings(registry)` → `{ Provider, useI18nContext }` — `"use client"`
- `interpolate(template, params?, locale?)` — the substitution primitive the registry uses internally (also exported from `ts7-i18n/registry`)
- `assertLocaleParamParity(base, locales)` / `collectParams(tree)` — the runtime param-parity check
- Types: `LL<T>`, `Translatable<T>`, `Translator<S>`, `Params<S>`, `ParamNames<S>`

## Compatibility

Tested against TypeScript 7.0.2. No dependency on the TypeScript compiler API at
any point, so there's nothing version-specific to break going forward. Works on
TypeScript 5.x too — nothing here requires TS7, it just doesn't *break* on it.

Node >= 20. React 18 or 19, optional.

## Contributing

Issues and pull requests are welcome at
[mr-kelly/ts7-i18n](https://github.com/mr-kelly/ts7-i18n).

```bash
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm build       # tsdown
```

## License

[MIT](./LICENSE)
