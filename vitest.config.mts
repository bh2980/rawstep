import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"]
  },
  resolve: {
    alias: {
      "@rawstep/action-catalog": resolve(__dirname, "packages/action-catalog/src"),
      "@rawstep/core": resolve(__dirname, "packages/core/src"),
      "@rawstep/agent": resolve(__dirname, "packages/agent/src"),
      "@rawstep/runtime": resolve(__dirname, "packages/runtime/src"),
      "@rawstep/reporter": resolve(__dirname, "packages/reporter/src")
    }
  }
});
