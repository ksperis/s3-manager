import { existsSync } from "node:fs";

import { defineConfig } from "@playwright/test";

const frontendUrl = "http://127.0.0.1:4173";
const backendHealthUrl = "http://127.0.0.1:8000/health";
const storageStatePath = "./e2e/.auth/browser-user.json";
const backendPython =
  process.env.E2E_PYTHON_BIN ??
  (existsSync("../backend/.venv/bin/python3")
    ? "../backend/.venv/bin/python3"
    : existsSync("../backend/.venv/bin/python")
      ? "../backend/.venv/bin/python"
      : "python3");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "../gl-test-reports/frontend-browser-e2e-junit.xml" }],
  ],
  use: {
    baseURL: frontendUrl,
    viewport: { width: 1728, height: 972 },
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /setup\/.*\.setup\.ts/,
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testMatch: /browser\/.*\.spec\.ts/,
      use: {
        browserName: "chromium",
        storageState: storageStatePath,
      },
    },
  ],
  webServer: [
    {
      command: `${backendPython} ../backend/tests_browser_e2e/serve.py`,
      url: backendHealthUrl,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4173",
      url: frontendUrl,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
