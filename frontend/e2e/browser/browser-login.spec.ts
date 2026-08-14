import { expect, test } from "@playwright/test";

import {
  E2E_BROWSER_CONNECTION_NAME,
  E2E_BUCKET_NAME,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "../helpers/config";

test.use({ storageState: { cookies: [], origins: [] } });

test("logs in with the UI user and lands on /browser", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_USER_EMAIL);
  await page.locator('input[type="password"]').fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/browser(?:\?.*)?$/);
  const response = await page.request.get("/api/connections");
  expect(response.ok()).toBe(true);
  const connections = (await response.json()) as Array<{ id: number; name: string }>;
  const connection = connections.find(
    (item) => item.name === E2E_BROWSER_CONNECTION_NAME,
  );
  expect(connection).toBeDefined();
  await page.goto(
    `/browser?ctx=${encodeURIComponent(`conn-${connection!.id}`)}&bucket=${encodeURIComponent(E2E_BUCKET_NAME)}`,
  );
  await expect(page.getByRole("button", { name: "Select bucket" })).toContainText(E2E_BUCKET_NAME);
});
