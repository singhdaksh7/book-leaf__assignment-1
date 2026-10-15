import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E against a disposable full stack (embedded PostgreSQL + built API + built web + mock OpenRouter),
 * started by e2e/stack.mjs. Prerequisites: `npm run build` at the repo root and a Playwright Chromium
 * (`npx playwright install chromium`, or E2E_CHROMIUM_PATH=<path to chrome(.exe)> to reuse an installed one).
 * Ports: E2E_API_PORT (3100) and E2E_WEB_PORT (5180).
 */
const webPort = Number(process.env.E2E_WEB_PORT ?? 5180);
const baseURL = `http://127.0.0.1:${webPort}`;
const executablePath = process.env.E2E_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  // Specs share one seeded database and run in file order; the first file builds the ticket the later ones continue.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  // Asks the stack to stop gracefully (PostgreSQL, API, temp files). Windows would otherwise force-kill it and orphan postgres.
  globalTeardown: "./e2e/global-teardown.ts",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", launchOptions: { executablePath } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } }],
  webServer: {
    command: "node e2e/stack.mjs",
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe"
  }
});
