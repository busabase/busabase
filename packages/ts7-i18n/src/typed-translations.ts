/**
 * The parameter a `{{…}}` plural block requires *on its own*: only the explicit
 * `{{key:one|other}}` form names one. The far more common `{{s}}` / `{{a|b}}`
 * form binds to the nearest preceding `{param}`, which `ParamNames` already
 * picks up from that parameter itself — so it contributes nothing extra here.
 */
type PluralParamName<Content extends string> = Content extends `${infer Key}:${string}`
  ? Key
  : never;

/**
 * Extracts `{paramName}` placeholders from a string literal type, stripping any
 * `:type` hint suffix (e.g. `{name:string}` extracts `name`) for forward
 * compatibility with typesafe-i18n-authored strings that use that syntax — the
 * suffix is not interpreted, only stripped so the param name still matches.
 *
 * `{{…}}` plural blocks are matched first and skipped, so a block like `{{s}}`
 * is never mistaken for a parameter named `s`.
 */
export type ParamNames<S extends string> =
  S extends `${infer Head}{{${infer Content}}}${infer Rest}`
    ? ParamNames<Head> | PluralParamName<Content> | ParamNames<Rest>
    : S extends `${string}{${infer Name}}${infer Rest}`
      ? (Name extends `${infer Bare}:${string}` ? Bare : Name) | ParamNames<Rest>
      : never;

/** The params object a translation string's accessor requires, or `undefined` if it takes none. */
export type Params<S extends string> = [ParamNames<S>] extends [never]
  ? undefined
  : { [K in ParamNames<S>]: string | number };

/** The callable shape for a single translation string: zero-arg if no params, else a single params-object arg. */
export type Translator<S extends string> = Params<S> extends undefined
  ? () => string
  : (params: Params<S>) => string;

/**
 * Maps a (possibly nested) translation tree to its callable-accessor shape
 * (typesafe-i18n's `LL` pattern). An array leaf (e.g. a `features: [...]` list)
 * becomes an index-keyed record — matching what the runtime `buildLL()` walker
 * actually produces (`Object.entries` on an array yields `"0"`, `"1"`, … keys),
 * not a `.map`-able array. Consume it via `Object.values(LL.x.features)`.
 */
export type LL<T> = {
  [K in keyof T]: T[K] extends string
    ? Translator<T[K]>
    : T[K] extends readonly (infer Item)[]
      ? Record<number, Item extends string ? Translator<Item> : LL<Item>>
      : T[K] extends object
        ? LL<T[K]>
        : never;
};

/**
 * Constrains a non-base locale to the base locale's exact key structure — a
 * missing key, an extra key, or a key nested at the wrong depth is a compile
 * error. String leaves widen to `string` (a translated string's own literal
 * content need not match the base locale's). Array leaves stay real arrays —
 * this is the shape you *author*; `LL<T>` is the shape you get back after
 * `buildLL()` walks it.
 */
export type Translatable<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends readonly (infer Item)[]
      ? readonly (Item extends string ? string : Translatable<Item>)[]
      : T[K] extends object
        ? Translatable<T[K]>
        : never;
};
