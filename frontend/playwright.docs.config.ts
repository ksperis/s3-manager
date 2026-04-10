import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./scripts/docs-screenshots",
  testMatch: "generate.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1728, height: 972 },
    locale: "en-US",
    timezoneId: "UTC",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
