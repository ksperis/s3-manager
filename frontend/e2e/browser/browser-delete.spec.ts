import { expect, test } from "@playwright/test";

import {
  getFileButton,
  openBucket,
  openFolder,
  openOperationsOverview,
} from "../helpers/browser";

test("deletes a seeded object and records the operation", async ({ page }) => {
  await openBucket(page);
  await openFolder(page, "delete");

  await page.getByRole("checkbox", { name: "Select delete-me.txt" }).check();
  await page.getByRole("checkbox", { name: "Select delete-me-too.txt" }).check();
  await page
    .getByRole("toolbar", { name: "Browser context bar" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();

  const confirmDialog = page.getByRole("dialog", { name: "Delete objects" });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByText("Deleted 2 object(s)")).toBeVisible();
  const operationsDialog = await openOperationsOverview(page);
  await operationsDialog.getByRole("button", { name: "Close modal" }).click();

  await expect(getFileButton(page, "delete-me.txt")).toHaveCount(0);
  await expect(getFileButton(page, "delete-me-too.txt")).toHaveCount(0);
});
