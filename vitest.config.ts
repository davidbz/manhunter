import { defineConfig } from "vitest/config";

/**
 * `*.slow.test.ts` matches `*.test.ts`, so the per-workspace projects have to exclude it by hand
 * or every slow test would run twice: once in its workspace and once in `slow`.
 */
const SLOW_FILES = ["src/**/*.slow.test.ts", "src/**/*.slow.test.tsx"];
const TEST_FILES = ["src/**/*.test.ts", "src/**/*.test.tsx"];

const WORKSPACE_ROOTS = ["packages/core", "packages/sim", "apps/web"];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          root: "packages/core",
          environment: "node",
          include: TEST_FILES,
          exclude: SLOW_FILES,
        },
      },
      {
        test: {
          name: "sim",
          root: "packages/sim",
          environment: "node",
          include: TEST_FILES,
          exclude: SLOW_FILES,
        },
      },
      {
        test: {
          name: "web",
          root: "apps/web",
          environment: "node",
          include: TEST_FILES,
          exclude: SLOW_FILES,
        },
      },
      {
        test: {
          name: "tools",
          root: ".",
          environment: "node",
          include: ["tools/**/*.test.ts"],
        },
      },
      /**
       * One project for every workspace's slow tests (PLAN "Where slow tests live"). `bun run test`
       * and CI run it; `bun run test:fast` filters it out for the inner loop. The trigger to move a
       * test here is measured, not felt: when `bun run verify` passes 60 seconds, the slowest moves.
       */
      {
        test: {
          name: "slow",
          root: ".",
          environment: "node",
          include: WORKSPACE_ROOTS.map((root) => `${root}/src/**/*.slow.test.{ts,tsx}`),
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
