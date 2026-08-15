import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globalSetup: "db/tests/global-setup.ts",
    include: ["db/tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
