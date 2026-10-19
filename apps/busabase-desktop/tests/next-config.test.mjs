import assert from "node:assert/strict";
import { test } from "node:test";
import config from "../next.config.mjs";

test("development keeps index.html routing without static export", async () => {
  const development = config("phase-development-server");
  assert.equal(development.output, undefined);
  assert.deepEqual(await development.rewrites(), [{ source: "/index.html", destination: "/" }]);
});

test("production retains static export without server-only rewrites", () => {
  const production = config("phase-production-build");
  assert.equal(production.output, "export");
  assert.equal(production.rewrites, undefined);
});
