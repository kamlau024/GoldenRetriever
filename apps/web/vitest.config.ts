import { defineConfig } from "vitest/config";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { environment: "jsdom", include: ["components/**/*.test.tsx"], globals: true },
});
