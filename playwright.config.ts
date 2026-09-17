import { defineConfig, devices } from "@playwright/test";

// AGENTS.md section 5: every boundary declares its time limit before it runs. The dev
// server, the browser and each assertion can all hang on external state.
const TEST_TIMEOUT_MS = 30_000;
const EXPECT_TIMEOUT_MS = 5_000;
const WEB_SERVER_TIMEOUT_MS = 120_000;

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

const CI_RETRIES = 2;
const LOCAL_RETRIES = 0;

// `in` rather than a property read: `noPropertyAccessFromIndexSignature` wants
// `env["CI"]` and Biome's `useLiteralKeys` wants `env.CI` (see PLAN Inbox).
const CI_ENV_VAR = "CI";
const isCi = CI_ENV_VAR in process.env;

export default defineConfig({
  testDir: "apps/web/e2e",
  // Vitest owns `src/**/*.test.ts`; Playwright owns `*.spec.ts` outside `src`. Neither
  // runner should ever see the other's files (PLAN M0.5).
  testMatch: "**/*.spec.ts",
  timeout: TEST_TIMEOUT_MS,
  expect: { timeout: EXPECT_TIMEOUT_MS },
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? CI_RETRIES : LOCAL_RETRIES,
  reporter: isCi ? "github" : "list",
  use: {
    baseURL: DEV_SERVER_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: {
    command: "bun run dev",
    url: DEV_SERVER_URL,
    timeout: WEB_SERVER_TIMEOUT_MS,
    reuseExistingServer: !isCi,
  },
});
