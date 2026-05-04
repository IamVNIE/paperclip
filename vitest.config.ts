import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/shared",
      "packages/db",
      "packages/adapter-utils",
      "packages/adapters/claude-local",
      "packages/adapters/codex-local",
      "packages/adapters/cursor-local",
      "packages/adapters/gemini-local",
      "packages/adapters/opencode-local",
      "packages/adapters/pi-local",
      "server",
      "ui",
      "cli",
    ],
    // Coverage instrumentation adds significant overhead; use serialized execution
    maxWorkers: process.env.COVERAGE || process.env.VITEST_MAX_WORKERS ? 1 : 2,
    minWorkers: 1,
  },
});
