import { expect, test } from "@playwright/test";

import { openBucket, openFolder } from "../helpers/browser";

test("opens object versions for a versioned Moto object", async ({ page }) => {
  await openBucket(page);
  await openFolder(page, "versions");

  const objectRow = page.locator("tr").filter({
    has: page.getByRole("button", { name: "report.json", exact: true }),
  });
  await objectRow.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menu").getByRole("button", { name: "Versions" }).click();

  const versionsDialog = page.getByRole("dialog", { name: /Object versions/ });
  await expect(versionsDialog).toBeVisible();
  await expect(versionsDialog).toContainText("Object versions");
  const restoreButtons = versionsDialog.getByRole("button", { name: "Restore" });
  await expect(restoreButtons).toHaveCount(3);
});
