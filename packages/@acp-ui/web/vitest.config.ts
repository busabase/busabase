import { defineConfig } from "vitest/config";

export default defineConfig({
  // `kui`'s components are consumed as source `.tsx`, and Vite's bare esbuild
  // default is the classic JSX transform — which needs a `React` global that
  // kui (correctly) never imports. Without this every kui component fails to
  // load with "React is not defined".
  esbuild: { jsx: "automatic" },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    exclude: ["node_modules/**"],
  },
});
