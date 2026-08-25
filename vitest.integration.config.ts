import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/setup/require-test-database.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    passWithNoTests: true,
    clearMocks: true,
    restoreMocks: true,
  },
})
