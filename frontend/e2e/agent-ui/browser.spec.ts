import { expect, test } from "@playwright/test";

import { collectApplicationErrors } from "../helpers/application-errors";
import { E2E_BUCKET_NAME } from "../helpers/config";

test("keeps an authenticated Browser session with the Moto bucket", async ({
  page,
}) => {
  const applicationErrors = collectApplicationErrors(page);

  await page.goto("/browser");
  await expect(page).toHaveURL(/\/browser(?:\?.*)?$/);
  await expect(page.getByRole("button", { name: "Select bucket" })).toContainText(
    E2E_BUCKET_NAME,
  );
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeVisible();
  expect((await page.request.get("/api/auth/session")).ok()).toBe(true);

  await page.reload();
  await expect(page).toHaveURL(/\/browser(?:\?.*)?$/);
  await expect(page.getByRole("button", { name: "Select bucket" })).toContainText(
    E2E_BUCKET_NAME,
  );
  expect(applicationErrors).toEqual([]);
});
