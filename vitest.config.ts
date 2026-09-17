import { defineConfig } from "vitest/config";

const TEST_FILES = ["src/**/*.test.ts", "src/**/*.test.tsx"];

export default defineConfig({
  test: {
    projects: [
      { test: { name: "core", root: "packages/core", environment: "node", include: TEST_FILES } },
      { test: { name: "sim", root: "packages/sim", environment: "node", include: TEST_FILES } },
      { test: { name: "web", root: "apps/web", environment: "node", include: TEST_FILES } },
      {
        test: {
          name: "tools",
          root: ".",
          environment: "node",
          include: ["tools/**/*.test.ts"],
        },
      },
    ],
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text-summary", "html"],
      reportsDirectory: "coverage",
      include: ["packages/core/src/**/*.ts"],
      exclude: ["packages/core/src/**/*.test.ts"],
    },
  },
});
