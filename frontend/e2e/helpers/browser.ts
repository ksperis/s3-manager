import { expect, type Page } from "@playwright/test";

import { E2E_BUCKET_NAME } from "./config";

export async function gotoBrowser(page: Page): Promise<void> {
  await page.goto("/browser");
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeVisible();
}

export async function openBucket(page: Page, bucketName = E2E_BUCKET_NAME): Promise<void> {
  await page.goto(`/browser?bucket=${encodeURIComponent(bucketName)}`);
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select bucket" })).toContainText(bucketName);
}

export async function openFolder(page: Page, folderName: string): Promise<void> {
  const folderButton = page.getByRole("button", { name: folderName, exact: true });
  await expect(folderButton).toBeVisible();
  await folderButton.dblclick();
}

export async function ensureActionBarEnabled(page: Page): Promise<void> {
  const actionBar = page.getByRole("toolbar", { name: "Browser actions bar" });
  if (await actionBar.isVisible().catch(() => false)) {
    return;
  }
  const contextBar = page.getByRole("toolbar", { name: "Browser context bar" });
  await contextBar.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: /Action bar/i }).click();
  await expect(actionBar).toBeVisible();
}
