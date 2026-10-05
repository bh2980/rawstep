import { defineConfig } from "vitest/config";

// Browser suites are opt-in and always serial. CI uses test:all, not just npm test.
const browser = process.env.RAWSTEP_TEST_SUITE === 'browser';
export default defineConfig({ test: {
  environment: 'node',
  include: browser ? ['tests/**/*.integration.test.ts'] : ['tests/**/*.test.ts'],
  exclude: browser ? [] : ['tests/**/*.integration.test.ts'],
  maxWorkers: 1, fileParallelism: false, bail: 1,
  testTimeout: browser ? 30_000 : 10_000, hookTimeout: 15_000,
} });
