import { expect, test } from "@playwright/test";

import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_FRONTEND_BASE_URL,
} from "../helpers/config";

test("enrolls and reuses a verified passkey with cookie-only multi-tab revocation", async ({
  context,
  page,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  const primaryLogin = async () => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(E2E_ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
  };
  const logout = async () => {
    const csrf = (await context.cookies()).find((cookie) => cookie.name === "csrf_token")?.value;
    expect(csrf).toBeTruthy();
    const response = await page.request.post("/api/auth/logout", {
      headers: { Origin: E2E_FRONTEND_BASE_URL, "X-CSRF-Token": csrf ?? "" },
    });
    expect(response.ok()).toBe(true);
  };

  await primaryLogin();
  await expect(page.getByRole("heading", { name: "Create your administrator passkey" })).toBeVisible();
  await page.getByRole("button", { name: "Create passkey" }).click();
  const recoveryCodes = page.locator("li").filter({ hasText: /^[a-f0-9]{8}-[a-f0-9]{8}$/ });
  await expect(recoveryCodes).toHaveCount(10);
  await page.getByRole("button", { name: "I saved these recovery codes" }).click();
  await expect(page).toHaveURL(/\/admin(?:\?.*)?$/);

  expect(await page.evaluate(() => window.localStorage.getItem("token"))).toBeNull();
  expect(await page.evaluate(() => document.cookie)).not.toContain("ui_access=");
  expect(await page.evaluate(() => document.cookie)).not.toContain("refresh_token=");
  let cookies = await context.cookies();
  expect(cookies.find((cookie) => cookie.name === "ui_access")?.httpOnly).toBe(true);
  expect(cookies.find((cookie) => cookie.name === "refresh_token")?.httpOnly).toBe(true);
  expect(cookies.find((cookie) => cookie.name === "csrf_token")?.httpOnly).toBe(false);

  await logout();
  await primaryLogin();
  await expect(page.getByRole("heading", { name: "Verify your passkey" })).toBeVisible();
  await page.getByRole("button", { name: "Use passkey" }).click();
  await expect(page).toHaveURL(/\/admin(?:\?.*)?$/);
  await page.reload();
  await expect(page).toHaveURL(/\/admin(?:\?.*)?$/);

  const secondTab = await context.newPage();
  await secondTab.goto("/admin");
  await expect(secondTab).toHaveURL(/\/admin(?:\?.*)?$/);

  await logout();
  await secondTab.reload();
  await expect(secondTab).toHaveURL(/\/login(?:\?.*)?$/);
  expect((await secondTab.request.get("/api/auth/session")).status()).toBe(401);
  cookies = await context.cookies();
  expect(cookies.some((cookie) => cookie.name === "ui_access" || cookie.name === "refresh_token")).toBe(false);

  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
});
