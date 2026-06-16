import { expect, test } from "@playwright/test";

import { openBucket, openFolder } from "../helpers/browser";

test("deletes a seeded object and records the operation", async ({ page }) => {
  await openBucket(page);
  await openFolder(page, "delete");

  await page.getByRole("checkbox", { name: "Select delete-me.txt" }).check();
  await page.getByRole("checkbox", { name: "Select delete-me-too.txt" }).check();
  await page
    .getByRole("toolbar", { name: "Browser context bar" })
    .getByRole("button", { name: "More", exact: true })
    .click();
  await page.getByRole("menu", { name: "More" }).getByRole("menuitem", { name: "Delete" }).click();

  const confirmDialog = page.getByRole("dialog", { name: "Delete objects" });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByText("Deleted 2 object(s)")).toBeVisible();
  await page.getByRole("button", { name: "Operations overview" }).click();
  const operationsDialog = page.getByRole("dialog", { name: "Operations overview" });
  await expect(operationsDialog).toBeVisible();
  await operationsDialog.getByRole("button", { name: "Close modal" }).click();

  await expect(page.getByRole("button", { name: "delete-me.txt", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "delete-me-too.txt", exact: true })).toHaveCount(0);
});
