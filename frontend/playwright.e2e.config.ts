import { existsSync } from "node:fs";

import { defineConfig } from "@playwright/test";

const frontendUrl = "http://localhost:4173";
const backendPort = process.env.E2E_BACKEND_PORT ?? "8000";
const backendHealthUrl = `http://127.0.0.1:${backendPort}/health`;
const motoServerUrl = process.env.E2E_S3_ENDPOINT ?? "http://localhost:5000";
const storageStatePath = "./e2e/.auth/browser-user.json";
const backendPython =
  process.env.E2E_PYTHON_BIN ??
  (existsSync("../backend/.venv/bin/python3")
    ? "../backend/.venv/bin/python3"
    : existsSync("../backend/.venv/bin/python")
      ? "../backend/.venv/bin/python"
      : "python3");
const shouldStartMoto =
  process.env.E2E_START_MOTO === "true" || Boolean(process.env.E2E_MOTO_COMMAND);
const motoServerCommand =
  process.env.E2E_MOTO_COMMAND ?? "moto_server -H 0.0.0.0 -p 5000";

const webServer = [
  ...(shouldStartMoto
    ? [
        {
          command: motoServerCommand,
          url: motoServerUrl,
          timeout: 120_000,
          reuseExistingServer: !process.env.CI,
        },
      ]
    : []),
  {
    command: `${backendPython} ../backend/tests_browser_e2e/serve.py`,
    url: backendHealthUrl,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  {
    command: "npm run dev -- --host localhost --port 4173",
    url: frontendUrl,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
];

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
      retries: 0,
      testMatch: "setup/**/*.setup.ts",
    },
    {
      name: "auth",
      dependencies: ["setup"],
      testMatch: "auth/**/*.spec.ts",
      use: {
        browserName: "chromium",
        storageState: { cookies: [], origins: [] },
      },
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testMatch: "browser/**/*.spec.ts",
      use: {
        browserName: "chromium",
        storageState: storageStatePath,
      },
    },
  ],
  webServer,
});
