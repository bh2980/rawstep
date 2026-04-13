import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@rawstep/core": resolve(__dirname, "packages/core/src"),
      "@rawstep/browser": resolve(__dirname, "packages/browser/src"),
      "@rawstep/actuator": resolve(__dirname, "packages/actuator/src"),
      "@rawstep/observer-keyboard": resolve(__dirname, "packages/observer-keyboard/src"),
      "@rawstep/observer-screenreader": resolve(__dirname, "packages/observer-screenreader/src"),
      "@rawstep/agent": resolve(__dirname, "packages/agent/src"),
      "@rawstep/runner": resolve(__dirname, "packages/runner/src"),
      "@rawstep/trace": resolve(__dirname, "packages/trace/src"),
      "@rawstep/reporter": resolve(__dirname, "packages/reporter/src")
    }
  }
});
