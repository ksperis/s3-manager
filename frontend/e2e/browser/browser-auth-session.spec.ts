import { expect, test } from "@playwright/test";

import {
  E2E_FRONTEND_BASE_URL,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "../helpers/config";

test.use({ storageState: { cookies: [], origins: [] } });

test("keeps authentication cookie-only across reloads and tabs, then revokes it on logout", async ({
  context,
  page,
}) => {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_USER_EMAIL);
  await page.locator('input[type="password"]').fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/browser(?:\?.*)?$/);
  expect(await page.evaluate(() => window.localStorage.getItem("token"))).toBeNull();
  expect(await page.evaluate(() => document.cookie)).not.toContain("ui_access=");
  expect(await page.evaluate(() => document.cookie)).not.toContain("refresh_token=");

  await page.reload();
  await expect(page).toHaveURL(/\/browser(?:\?.*)?$/);

  const secondTab = await context.newPage();
  await secondTab.goto("/browser");
  await expect(secondTab).toHaveURL(/\/browser(?:\?.*)?$/);

  const csrf = (await context.cookies()).find(
    (cookie) => cookie.name === "csrf_token",
  )?.value;
  expect(csrf).toBeTruthy();
  const logout = await page.request.post("/api/auth/logout", {
    headers: {
      Origin: E2E_FRONTEND_BASE_URL,
      "X-CSRF-Token": csrf ?? "",
    },
  });
  expect(logout.ok()).toBe(true);
  await secondTab.reload();
  await expect(secondTab).toHaveURL(/\/login(?:\?.*)?$/);

  const session = await secondTab.request.get("/api/auth/session");
  expect(session.status()).toBe(401);
  const cookies = await context.cookies();
  expect(cookies.some((cookie) => cookie.name === "ui_access" || cookie.name === "refresh_token")).toBe(false);
});
