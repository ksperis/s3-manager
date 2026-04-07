import { expect, test } from "@playwright/test";

import { E2E_BUCKET_NAME, E2E_USER_EMAIL, E2E_USER_PASSWORD } from "../helpers/config";

test.use({ storageState: { cookies: [], origins: [] } });

test("logs in with the UI user and lands on /browser", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_USER_EMAIL);
  await page.locator('input[type="password"]').fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/browser(?:\?.*)?$/);
  await expect(page.getByRole("button", { name: "Select bucket" })).toContainText(E2E_BUCKET_NAME);
});
