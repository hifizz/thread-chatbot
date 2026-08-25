import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    include: ["tests/client/**/*.test.{ts,tsx}"],
    clearMocks: true,
    restoreMocks: true,
  },
})
