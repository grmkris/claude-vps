import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    target: "esnext",
  },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
  },
});
