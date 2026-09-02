import { defineConfig } from "@playwright/test";

import {
  E2E_ADMIN_STORAGE_STATE_PATH,
  E2E_FRONTEND_BASE_URL,
  E2E_STORAGE_STATE_PATH,
} from "./e2e/helpers/config";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: E2E_FRONTEND_BASE_URL,
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
      testMatch: "setup/**/*.setup.ts",
    },
    {
      name: "agent-admin",
      dependencies: ["setup"],
      testMatch: "agent-ui/admin.spec.ts",
      use: {
        browserName: "chromium",
        storageState: E2E_ADMIN_STORAGE_STATE_PATH,
      },
    },
    {
      name: "agent-browser",
      dependencies: ["setup"],
      testMatch: "agent-ui/browser.spec.ts",
      use: {
        browserName: "chromium",
        storageState: E2E_STORAGE_STATE_PATH,
      },
    },
  ],
});
