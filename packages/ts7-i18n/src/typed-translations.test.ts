import { describe, expectTypeOf, it } from "vitest";
import type { LL, ParamNames, Params, Translatable, Translator } from "./typed-translations";

describe("ParamNames", () => {
  it("extracts no params from a plain string", () => {
    expectTypeOf<ParamNames<"hello">>().toEqualTypeOf<never>();
  });

  it("extracts a single param", () => {
    expectTypeOf<ParamNames<"hello {name}">>().toEqualTypeOf<"name">();
  });

  it("extracts multiple params as a union", () => {
    expectTypeOf<ParamNames<"{from} to {to}">>().toEqualTypeOf<"from" | "to">();
  });

  it("strips a :type hint suffix", () => {
    expectTypeOf<ParamNames<"code is {code:string}">>().toEqualTypeOf<"code">();
  });

  it("does not treat a {{…}} plural block as a parameter", () => {
    // Would otherwise infer a bogus param named "s".
    expectTypeOf<ParamNames<"{count} listing{{s}}">>().toEqualTypeOf<"count">();
    expectTypeOf<ParamNames<"{count:number} day{{s}} ago">>().toEqualTypeOf<"count">();
  });

  it("requires no params for a plural block with nothing to bind to", () => {
    expectTypeOf<ParamNames<"search{{es}}">>().toEqualTypeOf<never>();
  });

  it("picks up the param named by an explicit {{key:…}} plural block", () => {
    expectTypeOf<ParamNames<"{a} file{{b:|s}}">>().toEqualTypeOf<"a" | "b">();
  });
});

describe("Params", () => {
  it("is undefined for a zero-param string", () => {
    expectTypeOf<Params<"hello">>().toEqualTypeOf<undefined>();
  });

  it("requires a params object matching the extracted names", () => {
    expectTypeOf<Params<"hi {name}">>().toEqualTypeOf<{ name: string | number }>();
  });
});

describe("Translator", () => {
  it("is a zero-arg function for a zero-param string", () => {
    expectTypeOf<Translator<"hello">>().toEqualTypeOf<() => string>();
  });

  it("is a single-params-arg function for a param string", () => {
    expectTypeOf<Translator<"hi {name}">>().toEqualTypeOf<
      (params: { name: string | number }) => string
    >();
  });
});

describe("LL", () => {
  it("maps a nested namespace tree to callable accessors", () => {
    type Tree = { common: { save: string; greet: "hi {name}" } };
    expectTypeOf<LL<Tree>>().toEqualTypeOf<{
      common: { save: () => string; greet: (params: { name: string | number }) => string };
    }>();
  });

  it("maps an array of objects to an index-keyed record, not an array type", () => {
    type Tree = { features: { title: string; description: string }[] };
    expectTypeOf<LL<Tree>>().toEqualTypeOf<{
      features: Record<number, { title: () => string; description: () => string }>;
    }>();
  });

  it("maps an array of plain strings to an index-keyed record of translators", () => {
    type Tree = { changes: string[] };
    expectTypeOf<LL<Tree>>().toEqualTypeOf<{ changes: Record<number, () => string> }>();
  });

  it("Translatable keeps an array of plain strings as a readonly string array", () => {
    type Base = { changes: string[] };
    expectTypeOf<Translatable<Base>>().toEqualTypeOf<{ changes: readonly string[] }>();
  });
});

describe("Translatable", () => {
  it("widens string leaves to `string`, preserving nested structure", () => {
    type Base = { common: { save: "Save"; greet: "hi {name}" } };
    expectTypeOf<Translatable<Base>>().toEqualTypeOf<{
      common: { save: string; greet: string };
    }>();
  });

  it("rejects a locale object missing a base key", () => {
    type Base = { common: { save: string; cancel: string } };
    // @ts-expect-error -- missing `cancel`
    const _bad: Translatable<Base> = { common: { save: "保存" } };
  });

  it("rejects a locale object with an extra key not in the base", () => {
    type Base = { common: { save: string } };
    // @ts-expect-error -- `extra` is not a key of the base locale
    const _bad: Translatable<Base> = { common: { save: "保存", extra: "多余" } };
  });
});
