import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@a11y-task/core": resolve(__dirname, "packages/core/src"),
      "@a11y-task/browser": resolve(__dirname, "packages/browser/src"),
      "@a11y-task/actuator": resolve(__dirname, "packages/actuator/src"),
      "@a11y-task/observer-keyboard": resolve(__dirname, "packages/observer-keyboard/src"),
      "@a11y-task/agent": resolve(__dirname, "packages/agent/src"),
      "@a11y-task/runner": resolve(__dirname, "packages/runner/src"),
      "@a11y-task/trace": resolve(__dirname, "packages/trace/src"),
      "@a11y-task/reporter": resolve(__dirname, "packages/reporter/src")
    }
  }
});
