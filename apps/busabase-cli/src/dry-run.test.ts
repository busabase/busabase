import { describe, expect, it, vi } from "vitest";
import { matchRoute } from "./contract-catalog";
import {
  DRY_RUN_NO_WRITE_NOTE,
  DryRunInterception,
  dryRunFetch,
  observeRequests,
  renderDryRunPlan,
} from "./dry-run";
import { isTransientError } from "./retry";

const ok = () => new Response("{}", { status: 200 });

describe("dryRunFetch", () => {
  it("lets reads through untouched — they are what make the plan concrete", async () => {
    const inner = vi.fn(async () => ok());
    const wrapped = dryRunFetch(inner);
    for (const method of ["GET", "HEAD", "OPTIONS", undefined]) {
      await wrapped("https://busabase.test/api/v1/bases", method ? { method } : undefined);
    }
    expect(inner).toHaveBeenCalledTimes(4);
  });

  it("stops the first write and never calls through", async () => {
    const inner = vi.fn(async () => ok());
    const wrapped = dryRunFetch(inner);
    const thrown = await wrapped("https://busabase.test/api/v1/nodes", {
      method: "POST",
      body: JSON.stringify({ slug: "x" }),
    }).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(DryRunInterception);
    expect(inner).not.toHaveBeenCalled();
    const { plan } = thrown as DryRunInterception;
    expect(plan.method).toBe("POST");
    expect(plan.url).toBe("https://busabase.test/api/v1/nodes");
    expect(plan.body).toEqual({ slug: "x" });
  });

  it.each(["PUT", "PATCH", "DELETE"])("stops %s too", async (method) => {
    const inner = vi.fn(async () => ok());
    await expect(dryRunFetch(inner)("https://busabase.test/x", { method })).rejects.toBeInstanceOf(
      DryRunInterception,
    );
    expect(inner).not.toHaveBeenCalled();
  });

  it("keeps a non-JSON body legible instead of crashing on it", async () => {
    const thrown = (await dryRunFetch(async () => ok())("https://busabase.test/x", {
      method: "POST",
      body: "not json",
    }).catch((error: unknown) => error)) as DryRunInterception;
    expect(thrown.plan.body).toBe("not json");
  });

  it("is never mistaken for a transient failure worth retrying", () => {
    // The wrapper sits outside `withRetry` so this cannot happen by construction,
    // but a future reorder must not silently turn a dry run into a real write.
    const interception = new DryRunInterception({ method: "POST", url: "https://x/y" });
    expect(isTransientError(interception)).toBe(false);
    expect(interception).not.toBeInstanceOf(TypeError);
  });
});

describe("renderDryRunPlan", () => {
  it("says nothing was sent, and shows the request", () => {
    const rendered = renderDryRunPlan({
      method: "POST",
      url: "https://busabase.test/api/v1/nodes",
      body: { slug: "x" },
    });
    expect(rendered).toContain("nothing was sent");
    expect(rendered).toContain("POST https://busabase.test/api/v1/nodes");
    expect(rendered).toContain('"slug": "x"');
  });

  it("has a note for the case where no write was attempted at all", () => {
    expect(DRY_RUN_NO_WRITE_NOTE).toContain("sent no write");
    expect(DRY_RUN_NO_WRITE_NOTE).toContain("the output above is real");
  });
});

describe("observeRequests", () => {
  it("records method and path of every request, then calls through", async () => {
    const seen: Array<{ method: string; pathname: string }> = [];
    const inner = vi.fn(async () => ok());
    const wrapped = observeRequests(inner, (request) => seen.push(request));
    await wrapped("https://busabase.test/api/v1/bases?status=active");
    await wrapped("https://busabase.test/api/v1/nodes/nod_1/move", { method: "POST" });

    expect(inner).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([
      { method: "GET", pathname: "/api/v1/bases" },
      { method: "POST", pathname: "/api/v1/nodes/nod_1/move" },
    ]);
  });

  it("does not fail the request when the URL is not absolute", async () => {
    const inner = vi.fn(async () => ok());
    await expect(observeRequests(inner, () => {})("/relative")).resolves.toBeDefined();
    expect(inner).toHaveBeenCalledOnce();
  });
});

describe("matchRoute", () => {
  it("resolves a concrete request back to its contract endpoint", () => {
    expect(matchRoute("GET", "/api/v1/bases")?.id).toBe("bases.list");
  });

  it("fills {param} segments from the real path", () => {
    const matched = matchRoute("POST", "/api/v1/nodes/nod_abc/move");
    expect(matched?.id).toBe("nodes.move");
  });

  it("prefers a literal route over a parameterized one of the same shape", () => {
    // `/records/get` must not resolve to a `/records/{recordId}`-style route.
    expect(matchRoute("GET", "/api/v1/records/get")?.id).toBe("records.get");
  });

  it("returns undefined for a path the contract does not serve", () => {
    expect(matchRoute("GET", "/api/v1/definitely-not-a-route")).toBeUndefined();
    expect(matchRoute("DELETE", "/api/v1/bases")).toBeUndefined();
  });
});
