import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    server: {
      deps: {
        inline: ["@tanstack/react-query"],
      },
    },
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
