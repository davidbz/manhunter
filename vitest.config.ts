import { defineConfig } from "vitest/config";

/**
 * `*.slow.test.ts` matches `*.test.ts`, so the per-workspace projects have to exclude it by hand
 * or every slow test would run twice: once in its workspace and once in `slow`.
 */
const SLOW_FILES = ["src/**/*.slow.test.ts", "src/**/*.slow.test.tsx"];
const TEST_FILES = ["src/**/*.test.ts", "src/**/*.test.tsx"];

const WORKSPACE_ROOTS = ["packages/core", "packages/sim", "apps/web"];

/**
 * The suite's own time bound (AGENTS.md section 5: bound it in time, and name the bound). Vitest's
 * undeclared default is 5000ms, which held here and did not hold on CI - about four times slower -
 * where `game.test.ts` and `generate.slow.test.ts` timed out while passing locally. Neither hangs;
 * neither had ever been told how long it had.
 *
 * 30 seconds is `turn.slow.test.ts`'s own `DETERMINISM_TIMEOUT_MS`, the one heavy test that already
 * declared a bound and the one that survived CI. Reusing that number keeps a single answer to "how
 * long may a test take", and it still catches a real hang well inside the 10-minute CI job.
 *
 * It is set per project because `projects` do not inherit root `test` options: a root-level
 * `testTimeout` would read as bounded and enforce nothing. `tools/vitest/suite-bounds.test.ts`
 * fails if a project is added without one.
 */
const TEST_TIMEOUT_MS = 30_000;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          testTimeout: TEST_TIMEOUT_MS,
          root: "packages/core",
          environment: "node",
          include: TEST_FILES,
          exclude: SLOW_FILES,
        },
      },
      {
        test: {
          name: "sim",
          testTimeout: TEST_TIMEOUT_MS,
          root: "packages/sim",
          environment: "node",
          include: TEST_FILES,
          exclude: SLOW_FILES,
        },
      },
      {
        test: {
          name: "web",
          testTimeout: TEST_TIMEOUT_MS,
          root: "apps/web",
          /** The one project with a DOM (PLAN M5.2). Playwright still owns the e2e flows. */
          environment: "jsdom",
          include: TEST_FILES,
          exclude: SLOW_FILES,
        },
      },
      {
        test: {
          name: "tools",
          testTimeout: TEST_TIMEOUT_MS,
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
          testTimeout: TEST_TIMEOUT_MS,
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
