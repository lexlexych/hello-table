import { fileURLToPath } from "node:url";
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
        // Репозитории портала лежат здесь же: базу пересоздаёт один global-setup,
        // и второй проект с собственным setup сносил бы её из-под первого.
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./portal", import.meta.url)),
          },
        },
        test: {
          name: "database",
          globalSetup: "db/tests/global-setup.ts",
          include: ["db/tests/**/*.test.ts", "portal/tests/db/**/*.test.ts"],
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
      {
        // Портал использует алиас `@/…`, как принято в Next.js.
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./portal", import.meta.url)),
          },
        },
        test: {
          name: "portal",
          setupFiles: ["portal/tests/setup.ts"],
          include: ["portal/tests/**/*.test.ts"],
          // bcrypt cost 12 намеренно медленный: пары сверок хватает, чтобы выйти за секунду.
          testTimeout: 20_000,
        },
      },
    ],
  },
});
