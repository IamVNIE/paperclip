import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/db",
      "packages/adapters/codex-local",
      "packages/adapters/opencode-local",
      "server",
      "ui",
      "cli",
    ],
    // Coverage instrumentation adds significant overhead; use serialized execution
    maxWorkers: process.env.COVERAGE || process.env.VITEST_MAX_WORKERS ? 1 : 2,
    minWorkers: 1,
  },
});
