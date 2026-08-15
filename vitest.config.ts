import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "agent",
          setupFiles: ["agent/tests/setup.ts"],
          include: ["agent/tests/**/*.test.ts"],
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
      {
        test: {
          name: "database",
          globalSetup: "db/tests/global-setup.ts",
          include: ["db/tests/**/*.test.ts"],
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
