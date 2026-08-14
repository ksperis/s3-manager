import { expect, test } from "@playwright/test";

import { E2E_FRONTEND_BASE_URL } from "../helpers/config";

test("keeps authentication cookie-only across reloads and tabs, then revokes it on logout", async ({
  context,
  page,
}) => {
  await page.goto("/browser");
  await expect(page).toHaveURL(/\/browser(?:\?.*)?$/);
  expect(await page.evaluate(() => window.localStorage.getItem("token"))).toBeNull();
  expect(await page.evaluate(() => document.cookie)).not.toContain("ui_access=");
  expect(await page.evaluate(() => document.cookie)).not.toContain("refresh_token=");

  await page.reload();
  await expect(page).toHaveURL(/\/browser(?:\?.*)?$/);

  const secondTab = await context.newPage();
  await secondTab.goto("/browser");
  await expect(secondTab).toHaveURL(/\/browser(?:\?.*)?$/);

  const logout = await page.request.post("/api/auth/logout", {
    headers: { Origin: E2E_FRONTEND_BASE_URL },
  });
  expect(logout.ok()).toBe(true);
  await secondTab.reload();
  await expect(secondTab).toHaveURL(/\/login(?:\?.*)?$/);

  const session = await secondTab.request.get("/api/auth/session");
  expect(session.status()).toBe(401);
  const cookies = await context.cookies();
  expect(cookies.some((cookie) => cookie.name === "ui_access" || cookie.name === "refresh_token")).toBe(false);
});
