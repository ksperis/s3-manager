import { expect, type Locator, type Page } from "@playwright/test";

import { E2E_BUCKET_NAME } from "./config";

async function gotoBrowser(page: Page): Promise<void> {
  await page.goto("/browser");
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeVisible();
}

export async function openBucket(page: Page, bucketName = E2E_BUCKET_NAME): Promise<void> {
  await page.goto(`/browser?bucket=${encodeURIComponent(bucketName)}`);
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select bucket" })).toContainText(bucketName);
}

export function getFolderButton(page: Page, folderName: string): Locator {
  return page.getByRole("button", {
    name: `Open folder ${folderName}`,
    exact: true,
  });
}

export function getFileButton(page: Page, fileName: string): Locator {
  return page.getByRole("button", {
    name: `Open file ${fileName}`,
    exact: true,
  });
}

export async function openFolder(page: Page, folderName: string): Promise<void> {
  const folderButton = getFolderButton(page, folderName);
  await expect(folderButton).toBeVisible();
  await folderButton.dblclick();
}

export async function openOperationsOverview(page: Page): Promise<Locator> {
  const operationsPanel = page.getByRole("complementary", {
    name: "Operations",
  });
  await operationsPanel.getByRole("button", { name: "Expand operations" }).click();
  await operationsPanel.getByRole("button", { name: "Operations overview" }).click();
  const dialog = page.getByRole("dialog", { name: "Operations overview" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function ensureActionBarEnabled(page: Page): Promise<void> {
  const actionBar = page.getByRole("toolbar", { name: "Browser actions bar" });
  if (await actionBar.isVisible().catch(() => false)) {
    return;
  }
  const contextBar = page.getByRole("toolbar", { name: "Browser context bar" });
  await contextBar.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: /Action bar/i }).click();
  await expect(actionBar).toBeVisible();
}
