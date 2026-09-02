import { expect, test } from "@playwright/test";

import { collectApplicationErrors } from "../helpers/application-errors";

test("keeps an authenticated administrator session across reloads", async ({
  page,
}) => {
  const applicationErrors = collectApplicationErrors(page);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin(?:\?.*)?$/);
  await expect(page.getByRole("heading", { name: "Admin overview" })).toBeVisible();
  expect((await page.request.get("/api/auth/session")).ok()).toBe(true);

  await page.reload();
  await expect(page).toHaveURL(/\/admin(?:\?.*)?$/);
  await expect(page.getByRole("heading", { name: "Admin overview" })).toBeVisible();
  expect(applicationErrors).toEqual([]);
});
