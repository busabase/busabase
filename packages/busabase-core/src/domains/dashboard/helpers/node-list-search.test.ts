import { describe, expect, it } from "vitest";
import { filterNodeListByQuery, type SearchableNodeFields } from "./node-list-search";

const node = (name: string, slug: string, description = ""): SearchableNodeFields => ({
  name,
  slug,
  description,
});

describe("filterNodeListByQuery", () => {
  it("returns the list unchanged for an empty query, preserving server order", () => {
    const nodes = [node("Zebra", "zebra"), node("Apple", "apple")];
    expect(filterNodeListByQuery(nodes, "")).toEqual(nodes);
    expect(filterNodeListByQuery(nodes, "   ")).toEqual(nodes);
  });

  it("matches name, slug and description, case-insensitively", () => {
    const nodes = [
      node("Weekly Report", "weekly-report"),
      node("Inbox Zero", "inbox-zero", "Triages EMAIL every morning"),
      node("Unrelated", "unrelated"),
    ];
    expect(filterNodeListByQuery(nodes, "WEEKLY").map((n) => n.slug)).toEqual(["weekly-report"]);
    expect(filterNodeListByQuery(nodes, "inbox-").map((n) => n.slug)).toEqual(["inbox-zero"]);
    expect(filterNodeListByQuery(nodes, "email").map((n) => n.slug)).toEqual(["inbox-zero"]);
  });

  it("ranks an identity match above a description-only match", () => {
    const nodes = [
      node("Digest", "digest", "Summarises your email inbox"),
      node("Email", "email", "Nothing relevant here"),
    ];
    expect(filterNodeListByQuery(nodes, "email").map((n) => n.slug)).toEqual(["email", "digest"]);
  });

  it("keeps incoming order between nodes of the same rank", () => {
    const nodes = [node("Email B", "email-b"), node("Email A", "email-a")];
    expect(filterNodeListByQuery(nodes, "email").map((n) => n.slug)).toEqual([
      "email-b",
      "email-a",
    ]);
  });

  it("returns nothing when no node matches", () => {
    expect(filterNodeListByQuery([node("Alpha", "alpha", "beta")], "gamma")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const nodes = [node("B", "b"), node("A", "a")];
    filterNodeListByQuery(nodes, "");
    expect(nodes.map((n) => n.slug)).toEqual(["b", "a"]);
  });
});
