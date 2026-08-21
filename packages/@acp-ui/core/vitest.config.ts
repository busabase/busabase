import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // `reduce/` is pure and would run fine in node, but `session/` is a React
    // hook and needs a DOM to render into. One environment for the whole
    // package keeps the hook's tests from being silently skipped.
    environment: "jsdom",
    exclude: ["node_modules/**"],
  },
});
